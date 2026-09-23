// Backend for the footer "SEQUENCE" button (client/js/modules/sequence.js
// loads this file with $.evalFile() and then calls sequenceSelectedLayers()).
//
// For the layers currently selected in the active comp:
//   1. trims each one to exactly 1 frame,
//   2. lines them up back-to-back in current top-to-bottom stacking order,
//   3. precomposes the result into a single new comp.
//
// Helper function names below are prefixed "sequence" - see the note in
// depth.jsx for why: every host/modules/*.jsx file is loaded into the SAME
// ExtendScript global namespace for the life of the panel, so an unprefixed
// helper name (e.g. "getUniqueName") risks silently colliding with a
// same-named function some other module defines.

function sequenceSelectedLayers() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ ok: false, message: "Select an active composition." });
    }

    var selected = comp.selectedLayers;
    if (selected.length === 0) {
        return JSON.stringify({ ok: false, message: "Select one or more layers to sequence." });
    }

    var result = { ok: false, message: "" };

    app.beginUndoGroup("Sequence Layers to 1 Frame");
    try {
        var frameDuration = 1 / comp.frameRate;

        // Deterministic order: topmost selected layer (lowest index) goes
        // first, matching Adobe's own Scripts > Sequence Layers. selectedLayers
        // isn't documented to already come back in this order, so sort
        // explicitly instead of relying on undocumented behavior.
        var layers = selected.slice().sort(function (a, b) { return a.index - b.index; });
        var i;

        // 1. Trim every selected layer to exactly one frame. Anchored at each
        // layer's own inPoint (the tail is what gets cut), which is what
        // "set duration" normally means. Safe to do before repositioning:
        // shrinking outPoint towards inPoint never crosses it.
        for (i = 0; i < layers.length; i++) {
            layers[i].outPoint = layers[i].inPoint + frameDuration;
        }

        // 2. Sequence back-to-back. The first (topmost) layer keeps its
        // current position; every layer after it is moved - via startTime,
        // which shifts inPoint/outPoint together and so preserves the
        // 1-frame trim from step 1 - so its inPoint lands exactly on the
        // previous layer's new outPoint.
        var cursor = layers[0].inPoint;
        var indices = [];
        for (i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var delta = cursor - layer.inPoint;
            if (delta !== 0) layer.startTime += delta;
            cursor = layer.outPoint;
            indices.push(layer.index);
        }
        var sequenceStart = layers[0].inPoint;
        var sequenceEnd = cursor;

        // 3. Precompose. moveAllAttributes must be true here regardless -
        // AE only allows false when precomposing a single layer.
        var compName = sequenceGetUniqueName("Sequence Precomp");
        var newComp = comp.layers.precompose(indices, compName, true);

        // Trim the new precomp - and the layer that now represents it back
        // in the parent comp - to the span the sequence actually occupies,
        // rather than leaving the precomp the same length as the whole
        // parent comp. Delete this block if you'd rather keep the parent
        // comp's full duration.
        var span = sequenceEnd - sequenceStart;
        newComp.duration = span;

        var outerLayer = sequenceFindLayerBySource(comp, newComp);
        if (outerLayer) {
            outerLayer.startTime = sequenceStart; // also moves inPoint to sequenceStart
            outerLayer.outPoint = sequenceEnd;
        }

        result.ok = true;
        result.message = layers.length + " layer" + (layers.length === 1 ? "" : "s") +
            " sequenced into \"" + newComp.name + "\".";
    } catch (err) {
        result.ok = false;
        result.message = "Sequence Error: " + err.toString();
    } finally {
        app.endUndoGroup();
    }

    return JSON.stringify(result);
}

// Finds the layer in `comp` whose source is `item` - used right after
// precompose() to locate the new representation layer without depending on
// name-lookup semantics (precompose names it the same as the new comp by
// default, but matching on source is unambiguous either way).
function sequenceFindLayerBySource(comp, item) {
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        if (comp.layer(i).source === item) return comp.layer(i);
    }
    return null;
}

function sequenceGetUniqueName(baseName) {
    var name = baseName;
    var suffix = 2;
    while (sequenceNameExists(name)) {
        name = baseName + " " + suffix;
        suffix++;
    }
    return name;
}

function sequenceNameExists(name) {
    var i;
    for (i = 1; i <= app.project.numItems; i++) {
        if (app.project.item(i).name === name) return true;
    }
    return false;
}
