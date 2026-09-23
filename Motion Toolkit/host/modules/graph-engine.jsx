function graphClamp(value, minimum, maximum) {
    return Math.min(Math.max(value, minimum), maximum);
}

function graphBezierCoordinate(t, first, second) {
    var inverse = 1 - t;
    return 3 * inverse * inverse * t * first + 3 * inverse * t * t * second + t * t * t;
}

function graphSolveBezierTime(progress, curve) {
    var low = 0;
    var high = 1;
    var guess = progress;

    for (var iteration = 0; iteration < 14; iteration++) {
        var x = graphBezierCoordinate(guess, curve.x1, curve.x2);
        if (Math.abs(x - progress) < 0.00001) {
            return guess;
        }
        if (x < progress) {
            low = guess;
        } else {
            high = guess;
        }
        guess = (low + high) / 2;
    }
    return guess;
}

function graphEvaluate(graph, progress) {
    var t = graphClamp(progress, 0, 1);

    if (graph.type === "bezier" || graph.type === "custom") {
        var curve = graph.type === "custom" ? graph.custom : graph.bezier;
        var solvedTime = graphSolveBezierTime(t, curve);
        return graphBezierCoordinate(solvedTime, curve.y1, curve.y2);
    }

    if (graph.type === "elastic") {
        if (t === 0 || t === 1) {
            return t;
        }
        return t + graph.elastic.amplitude * Math.sin(t / graph.elastic.period * Math.PI * 2)
            * 2 * Math.exp(-graph.elastic.damping * t) * (1 - t);
    }

    if (graph.type === "bouncing") {
        if (t === 0 || t === 1) {
            return t;
        }
        var bounce = graph.bouncing;
        var bounces = Math.max(1, Math.round(bounce.bounces || 1));
        var segments = bounces + 1;
        var segment = Math.min(Math.floor(t * segments), segments - 1);
        if (segment === 0) {
            var localTime = t * segments;
            return localTime * localTime;
        }
        var segmentMid = (segment + 0.5) / segments;
        var halfWidth = 0.5 / segments;
        var normalized = (t - segmentMid) / halfWidth;
        return 1 - Math.pow(bounce.strength, segment) * (1 - normalized * normalized);
    }

    if (graph.type === "step") {
        var step = t * graph.step.steps;
        var hold = graph.step.hold || "floor";
        var quantized = hold === "ceil" ? Math.ceil(step) : hold === "round" ? Math.round(step) : Math.floor(step);
        return graphClamp(quantized / graph.step.steps, 0, 1);
    }

    return t;
}

// NOTE: there used to be a "speed" branch here that summed graphEvaluate()
// differences across 32 sub-steps. That sum always telescopes back to
// graphEvaluate(graph, progress) - graphEvaluate(graph, 0), which is just
// graphEvaluate(graph, progress) again since every curve here starts at 0 -
// so it was mathematically a no-op dressed up as a 32-iteration loop, and
// "SPEED" mode ended up applying identically to "VALUE" mode. Rather than
// silently keep shipping that, applyMotionGraph() now refuses to apply while
// in SPEED mode at all (see below) until this is done properly.
function graphEvaluateForMode(graph, progress) {
    return graphEvaluate(graph, progress);
}

function graphSampleCount(graph) {
    if (graph.type === "elastic") return 96;
    if (graph.type === "bouncing") return 72;
    if (graph.type === "step") return Math.max(1, graph.step.steps);
    return 40;
}

// x (or 1-x2 for the incoming handle) is the horizontal reach of a bezier
// tangent - 0 is a deliberate "as sharp as possible" curve shape (an almost
// vertical tangent), not a degenerate one. AE's own influence can't go below
// 0.1% anyway, so flooring here at the same 0.001 instead of leaving x at
// exactly 0 keeps the intent instead of dividing by zero.
function graphEffectiveHandleX(x) {
    var minimum = 0.001;
    return Math.abs(x) < minimum ? minimum : x;
}

function graphEaseSpeed(y, x, delta, duration) {
    if (Math.abs(delta) < 0.000001 || duration <= 0) {
        return 0;
    }
    // A tiny x combined with a normal delta/duration can legitimately want a
    // very large speed (that's what makes the start/end of the segment look
    // sharp) - clamp to a generous but finite range rather than letting a
    // pathological combination of values produce something AE might reject.
    return graphClamp(y / x * delta / duration, -1000000, 1000000);
}

// Returns the keyframe indices (1-based, sorted, matching the property's own
// numbering) that a graph application should touch: the user's own keyframe
// selection when they've highlighted two or more specific keyframes, or every
// keyframe on the property when they've only selected the property row itself
// (comp.selectedProperties includes a property with no individual keyframes
// highlighted whenever you click its name rather than its diamonds).
function graphGetTargetKeyIndices(property) {
    var selected = null;
    try {
        selected = property.selectedKeys;
    } catch (readError) {
        selected = null;
    }
    if (selected && selected.length >= 2) {
        var sorted = [];
        for (var i = 0; i < selected.length; i++) {
            sorted.push(selected[i]);
        }
        sorted.sort(function (a, b) { return a - b; });
        return sorted;
    }
    var all = [];
    for (var keyIndex = 1; keyIndex <= property.numKeys; keyIndex++) {
        all.push(keyIndex);
    }
    return all;
}

function graphHasAdjacentPair(keyIndices) {
    for (var i = 0; i < keyIndices.length - 1; i++) {
        if (keyIndices[i + 1] === keyIndices[i] + 1) {
            return true;
        }
    }
    return false;
}

function graphContainsIndex(list, value) {
    for (var i = 0; i < list.length; i++) {
        if (list[i] === value) {
            return true;
        }
    }
    return false;
}

// Builds a "(i1 === a && i2 === b) || ..." condition restricting a generated
// AE expression to only the keyframe pairs the user actually selected, so an
// expression applied to 2 of a property's 3 keyframes doesn't reshape the
// whole property. Returns null when there's nothing to restrict (the target
// covers every keyframe already, or no adjacent pair survived).
function graphBuildSegmentGuard(keyIndices, numKeys) {
    if (!keyIndices || keyIndices.length >= numKeys) {
        return null;
    }
    var pairs = [];
    for (var i = 0; i < keyIndices.length - 1; i++) {
        var a = keyIndices[i];
        var b = keyIndices[i + 1];
        if (b === a + 1) {
            pairs.push("(i1 === " + a + " && i2 === " + b + ")");
        }
    }
    if (pairs.length === 0) {
        return null;
    }
    return pairs.join(" || ");
}

// Applies native bezier temporal ease only between genuinely adjacent
// keyIndices pairs (no unselected keyframe sitting between them), touching
// only the AE keyframe indices involved - never the whole property.
function graphApplyBezierInterpolation(property, keyIndices, graph) {
    var curve = graph.type === "custom" ? graph.custom : graph.bezier;
    var easeIn = {};
    var easeOut = {};
    var touchedIndices = [];

    for (var i = 0; i < keyIndices.length - 1; i++) {
        var startKeyIndex = keyIndices[i];
        var endKeyIndex = keyIndices[i + 1];
        if (endKeyIndex !== startKeyIndex + 1) {
            continue;
        }

        var startTime = property.keyTime(startKeyIndex);
        var endTime = property.keyTime(endKeyIndex);
        var duration = endTime - startTime;
        var startValue = property.keyValue(startKeyIndex);
        var endValue = property.keyValue(endKeyIndex);
        var componentCount = startValue instanceof Array ? startValue.length : 1;
        var outgoing = [];
        var incoming = [];

        for (var component = 0; component < componentCount; component++) {
            var start = startValue instanceof Array ? startValue[component] : startValue;
            var end = endValue instanceof Array ? endValue[component] : endValue;
            var delta = end - start;
            var outgoingX = graphEffectiveHandleX(curve.x1);
            var incomingX = graphEffectiveHandleX(1 - curve.x2);
            outgoing.push(new KeyframeEase(graphEaseSpeed(curve.y1, outgoingX, delta, duration), graphClamp(outgoingX * 100, 0.1, 100)));
            incoming.push(new KeyframeEase(graphEaseSpeed(1 - curve.y2, incomingX, delta, duration), graphClamp(incomingX * 100, 0.1, 100)));
        }

        easeOut[startKeyIndex] = outgoing;
        easeIn[endKeyIndex] = incoming;
        if (!graphContainsIndex(touchedIndices, startKeyIndex)) touchedIndices.push(startKeyIndex);
        if (!graphContainsIndex(touchedIndices, endKeyIndex)) touchedIndices.push(endKeyIndex);
    }

    for (var t = 0; t < touchedIndices.length; t++) {
        var keyIndex = touchedIndices[t];
        var inEase = easeIn[keyIndex] || easeOut[keyIndex];
        var outEase = easeOut[keyIndex] || easeIn[keyIndex];
        property.setInterpolationTypeAtKey(keyIndex, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
        property.setTemporalEaseAtKey(keyIndex, inEase, outEase);
    }

    return touchedIndices.length > 0;
}

function graphBuildExpressionValueBody() {
    return "try { var v1 = key(i1).value, v2 = key(i2).value;\n"
        + "if (v1 instanceof Array) { var r=[]; for(var ci=0;ci<v1.length;ci++) r.push(v1[ci]+(v2[ci]-v1[ci])*finalEase); r; }\n"
        + "else if (typeof v1 === 'object' && v1.points) { var p1pts=v1.points(), p2pts=v2.points(); if (p1pts.length===p2pts.length) { var p1in=v1.inTangents(), p2in=v2.inTangents(), p1out=v1.outTangents(), p2out=v2.outTangents(), pts=[], inT=[], outT=[]; for(var ci=0;ci<p1pts.length;ci++){ pts.push(p1pts[ci]+(p2pts[ci]-p1pts[ci])*finalEase); inT.push(p1in[ci]+(p2in[ci]-p1in[ci])*finalEase); outT.push(p1out[ci]+(p2out[ci]-p1out[ci])*finalEase); } createPath(pts,inT,outT,v1.isClosed()); } else valueAtTime(t1+(t2-t1)*finalEase); }\n"
        + "else { v1+(v2-v1)*finalEase; } } catch(e) { valueAtTime(t1+(t2-t1)*finalEase); }\n";
}

function graphBuildElasticExpression(graph, keyIndices, numKeys) {
    var elastic = graph.elastic;
    var amplitude = Number(elastic.amplitude).toFixed(4);
    var frequency = (1 / Math.max(0.02, Number(elastic.period))).toFixed(4);
    var decay = Number(elastic.damping).toFixed(4);
    var guard = graphBuildSegmentGuard(keyIndices, numKeys);
    var guardLine = guard ? ("else if (!(" + guard + ")) value;\n") : "";
    return "var amp = " + amplitude + ";\n"
        + "var freq = " + frequency + ";\n"
        + "var decay = " + decay + ";\n"
        + "var i2 = 2; while (i2 <= numKeys && time > key(i2).time) i2++; var i1 = i2 - 1;\n"
        + "if (i1 < 1 || i2 > numKeys) value;\n"
        + guardLine
        + "else { var t1 = key(i1).time; var t2 = key(i2).time; if (time < t1 || time > t2) value; else {\n"
        + "var t = (time - t1) / (t2 - t1);\n"
        + "var finalEase = 1 - amp * Math.exp(-decay * t) * Math.cos(freq * Math.PI * 2 * t);\n"
        + graphBuildExpressionValueBody()
        + "} }";
}

function graphBuildBounceExpression(graph, keyIndices, numKeys) {
    var bounce = graph.bouncing;
    var bounces = Math.max(1, Math.round(Number(bounce.bounces)));
    var stiffness = Number(bounce.strength).toFixed(4);
    var guard = graphBuildSegmentGuard(keyIndices, numKeys);
    var guardLine = guard ? ("else if (!(" + guard + ")) value;\n") : "";
    return "var bounces = " + bounces + ";\nvar stiffness = " + stiffness + ";\n"
        + "var i2 = 2; while (i2 <= numKeys && time > key(i2).time) i2++; var i1 = i2 - 1;\n"
        + "if (i1 < 1 || i2 > numKeys) value;\n"
        + guardLine
        + "else { var t1 = key(i1).time; var t2 = key(i2).time; if (time < t1 || time > t2) value; else {\n"
        + "var t = (time - t1) / (t2 - t1); var segs=bounces+1; var seg=Math.min(Math.floor(t*segs),segs-1); var finalEase;\n"
        + "if(seg==0){var lt=t*segs; finalEase=lt*lt;} else {var segMid=(seg+0.5)/segs; var halfWidth=0.5/segs; var nt=(t-segMid)/halfWidth; finalEase=1-Math.pow(stiffness,seg)*(1-nt*nt);}\n"
        + graphBuildExpressionValueBody()
        + "} }";
}

function graphBuildBezierExpression(graph, keyIndices, numKeys) {
    var curve = graph.type === "custom" ? graph.custom : graph.bezier;
    var guard = graphBuildSegmentGuard(keyIndices, numKeys);
    var guardLine = guard ? ("else if (!(" + guard + ")) value;\n") : "";
    return "var x1 = " + Number(curve.x1).toFixed(4) + "; var y1 = " + Number(curve.y1).toFixed(4) + "; var x2 = " + Number(curve.x2).toFixed(4) + "; var y2 = " + Number(curve.y2).toFixed(4) + ";\n"
        + "var i2 = 2; while (i2 <= numKeys && time > key(i2).time) i2++; var i1 = i2 - 1;\n"
        + "if (i1 < 1 || i2 > numKeys) value;\n"
        + guardLine
        + "else { var t1 = key(i1).time; var t2 = key(i2).time; if (time < t1 || time > t2) value; else {\n"
        + "var p = (time - t1) / (t2 - t1); var lo = 0; var hi = 1; var u = p;\n"
        + "for (var si = 0; si < 16; si++) { var inv = 1 - u; var xx = 3 * inv * inv * u * x1 + 3 * inv * u * u * x2 + u * u * u; if (xx < p) lo = u; else hi = u; u = (lo + hi) / 2; }\n"
        + "var inv2 = 1 - u; var ease = 3 * inv2 * inv2 * u * y1 + 3 * inv2 * u * u * y2 + u * u * u; var v1 = key(i1).value; var v2 = key(i2).value;\n"
        + "if (v1 instanceof Array) { var r=[]; for (var ci=0; ci<v1.length; ci++) r.push(v1[ci] + (v2[ci] - v1[ci]) * ease); r; } else { v1 + (v2 - v1) * ease; } } }";
}

function graphFindSelectedProperty(comp) {
    var properties = comp.selectedProperties;
    for (var i = properties.length - 1; i >= 0; i--) {
        if (properties[i].numKeys !== undefined && properties[i].numKeys >= 2) {
            return properties[i];
        }
    }
    return null;
}

function graphFindSelectedProperties(comp) {
    var properties = [];
    var selected = comp.selectedProperties;
    for (var i = selected.length - 1; i >= 0; i--) {
        if (selected[i].numKeys !== undefined && selected[i].numKeys >= 2) {
            properties.push(selected[i]);
        }
    }
    return properties;
}

function graphIsSupportedValue(value) {
    return typeof value === "number" || value instanceof Array;
}

function graphAddSample(samples, time, value) {
    for (var i = 0; i < samples.length; i++) {
        if (Math.abs(samples[i].time - time) < 0.000001) {
            samples[i].value = value;
            return;
        }
    }
    samples.push({ time: time, value: value });
}

function graphTimeInRanges(time, ranges) {
    for (var i = 0; i < ranges.length; i++) {
        if (time >= ranges[i].start - 0.000001 && time <= ranges[i].end + 0.000001) {
            return true;
        }
    }
    return false;
}

// Bakes dense sampled keyframes (used for "step", and for bezier/custom when
// something other than native temporal ease is needed) only across spans
// where both bounding keyframes were selected and adjacent - keyframes
// outside every such span are left completely alone.
function graphApplyBakedSamples(property, keyIndices, graph) {
    var samples = [];
    var reshapedRanges = [];

    for (var i = 0; i < keyIndices.length - 1; i++) {
        var startKeyIndex = keyIndices[i];
        var endKeyIndex = keyIndices[i + 1];
        if (endKeyIndex !== startKeyIndex + 1) {
            continue;
        }

        var startTime = property.keyTime(startKeyIndex);
        var endTime = property.keyTime(endKeyIndex);
        var duration = endTime - startTime;
        var count = graphSampleCount(graph);

        for (var sampleIndex = 0; sampleIndex <= count; sampleIndex++) {
            var localProgress = sampleIndex / count;
            var sourceTime = startTime + graphEvaluateForMode(graph, localProgress) * duration;
            var outputTime = startTime + localProgress * duration;
            var sampledValue = property.valueAtTime(sourceTime, true);
            graphAddSample(samples, outputTime, sampledValue);
        }
        reshapedRanges.push({ start: startTime, end: endTime });
    }

    if (reshapedRanges.length === 0) {
        return false;
    }

    for (var removeIndex = property.numKeys; removeIndex >= 1; removeIndex--) {
        if (graphTimeInRanges(property.keyTime(removeIndex), reshapedRanges)) {
            property.removeKey(removeIndex);
        }
    }

    for (var s = 0; s < samples.length; s++) {
        property.setValueAtTime(samples[s].time, samples[s].value);
    }

    if (graph.type === "step") {
        for (var stepKey = 1; stepKey <= property.numKeys; stepKey++) {
            if (graphTimeInRanges(property.keyTime(stepKey), reshapedRanges)) {
                property.setInterpolationTypeAtKey(stepKey, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
            }
        }
    }

    if (property.isSpatial) {
        for (var spatialIndex = 1; spatialIndex <= property.numKeys; spatialIndex++) {
            if (graphTimeInRanges(property.keyTime(spatialIndex), reshapedRanges)) {
                try {
                    property.setSpatialContinuousAtKey(spatialIndex, true);
                } catch (spatialError) {
                    // Some spatial property types do not expose this setter.
                }
            }
        }
    }

    return true;
}

function applyMotionGraph(serializedPayload) {
    var payload;
    try {
        payload = JSON.parse(serializedPayload);
    } catch (parseError) {
        return JSON.stringify({ ok: false, message: "Invalid graph payload: " + parseError.toString() });
    }

    if (!payload || !payload.graph) {
        return JSON.stringify({ ok: false, message: "Invalid graph configuration." });
    }

    if (payload.mode === "speed") {
        return JSON.stringify({ ok: false, message: "SPEED mode is preview-only right now - switch to VALUE mode before applying." });
    }

    if (payload.graph.type === "elastic" || payload.graph.type === "bouncing") {
        payload.expressionMode = "expression";
    }

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ ok: false, message: "Select an active composition." });
    }

    var properties = graphFindSelectedProperties(comp);
    if (properties.length === 0) {
        return JSON.stringify({ ok: false, message: "Select one or more animated properties with at least two keyframes." });
    }

    var results = [];
    app.beginUndoGroup("Apply Motion Graph");
    try {
        for (var propertyIndex = 0; propertyIndex < properties.length; propertyIndex++) {
            results.push(applyMotionGraphToProperty(payload, properties[propertyIndex]));
        }
    } finally {
        app.endUndoGroup();
    }

    var succeeded = 0;
    var messages = [];
    for (var r = 0; r < results.length; r++) {
        if (results[r].ok) succeeded++;
        messages.push(results[r].message);
    }
    return JSON.stringify({ ok: succeeded > 0, message: messages.join(" ") });
}

// Only ever called from applyMotionGraph's loop above (always with a
// pre-parsed payload and a real, qualifying property), so it owns no undo
// group of its own - the loop's single group covers the whole batch, which
// is also what makes the whole Apply action a single Ctrl+Z step.
// Returns a plain {ok, message} object (not a JSON string) - applyMotionGraph
// is the one that serializes the combined result for evalScript to hand back.
function applyMotionGraphToProperty(payload, property) {
    if (property.numKeys < 2) {
        return {
            ok: false,
            message: payload.expressionMode === "expression"
                ? "Expression mode needs at least two keyframes on " + property.name + "."
                : "Keyframe mode needs at least two keyframes on " + property.name + "."
        };
    }

    var keyIndices = graphGetTargetKeyIndices(property);
    if (keyIndices.length < 2 || !graphHasAdjacentPair(keyIndices)) {
        return { ok: false, message: "Select two adjacent keyframes on " + property.name + " to shape a segment." };
    }

    if (payload.expressionMode === "expression") {
        try {
            if (payload.graph.type === "elastic") {
                property.expression = graphBuildElasticExpression(payload.graph, keyIndices, property.numKeys);
            } else if (payload.graph.type === "bouncing") {
                property.expression = graphBuildBounceExpression(payload.graph, keyIndices, property.numKeys);
            } else if (payload.graph.type === "bezier" || payload.graph.type === "custom") {
                property.expression = graphBuildBezierExpression(payload.graph, keyIndices, property.numKeys);
            } else {
                return { ok: false, message: "Expression mode is not supported for this curve type." };
            }
        } catch (expressionError) {
            return { ok: false, message: "Could not apply " + payload.graph.type + " expression to " + property.name + ": " + expressionError.toString() };
        }
        return { ok: true, message: "Applied " + payload.graph.type + " expression to " + property.name + "." };
    }

    if (property.expressionEnabled) {
        return { ok: false, message: "Disable the expression on " + property.name + " before applying keyframes." };
    }

    var firstValue = property.keyValue(1);
    if (!graphIsSupportedValue(firstValue)) {
        return { ok: false, message: "The value type of " + property.name + " is not supported." };
    }

    if (payload.graph.type === "bezier" || payload.graph.type === "custom") {
        try {
            var reshaped = graphApplyBezierInterpolation(property, keyIndices, payload.graph);
            if (!reshaped) return { ok: false, message: "Select two adjacent keyframes on " + property.name + " to shape a segment." };
        } catch (applyError) {
            return { ok: false, message: "Could not apply graph to " + property.name + ": " + applyError.toString() };
        }
        return { ok: true, message: "Applied motion graph to " + keyIndices.length + " keyframe(s) on " + property.name + "." };
    }

    try {
        var baked = graphApplyBakedSamples(property, keyIndices, payload.graph);
        if (!baked) return { ok: false, message: "Select two adjacent keyframes on " + property.name + " to shape a segment." };
    } catch (applyError) {
        return { ok: false, message: "Could not apply graph to " + property.name + ": " + applyError.toString() };
    }
    return { ok: true, message: "Applied motion graph to " + property.name + "." };
}

function getMotionGraphContext() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ empty: true, status: "NO COMPOSITION", detail: "Select a composition in After Effects." });
    }

    if (comp.selectedLayers.length === 0) {
        return JSON.stringify({ empty: true, status: "NO LAYER", detail: "Select a layer with an animated property." });
    }

    var property = graphFindSelectedProperty(comp);
    if (!property) {
        return JSON.stringify({ empty: true, status: "NO PROPERTY", detail: "Select a property with at least two keyframes." });
    }

    if (!graphIsSupportedValue(property.keyValue(1))) {
        return JSON.stringify({ empty: true, status: "UNSUPPORTED", detail: "The selected property value type is not supported." });
    }

    var selectedKeys = null;
    try {
        selectedKeys = property.selectedKeys;
    } catch (readError) {
        selectedKeys = null;
    }
    var selectedKeyCount = (selectedKeys && selectedKeys.length >= 2) ? selectedKeys.length : 0;

    return JSON.stringify({
        empty: false,
        status: "PROPERTY READY",
        detail: property.name,
        keyframeCount: property.numKeys,
        selectedKeyCount: selectedKeyCount
    });
}
