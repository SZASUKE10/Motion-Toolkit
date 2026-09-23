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
        //
        // IMPORTANT: precompose() re-orders the contents of the new comp by
        // LAYER INDEX (lowest index becomes the top layer), not by timeline
        // position. `indices` above is in stacking order (topmost first =
        // lowest index first), so inside the precomp the sequence would come
        // out reversed relative to the parent comp. Fix: sort the indices
        // ascending (which makes the precomp's stacking match the parent's)
        // and then explicitly re-order the precomp's layers by their new
        // inPoints so frame 1 of the sequence is the FIRST layer in time,
        // regardless of how AE stacked them.
        indices.sort(function (a, b) { return a - b; });
        var compName = sequenceGetUniqueName("Sequence Precomp");
        var newComp = comp.layers.precompose(indices, compName, true);

        // Trim the new precomp - and the layer that now represents it back
        // in the parent comp - to the span the sequence actually occupies,
        // rather than leaving the precomp the same length as the whole
        // parent comp. Delete this block if you'd rather keep the parent
        // comp's full duration.
        var span = sequenceEnd - sequenceStart;
        newComp.duration = span;

        // 4. Order the precomp's layers by timeline position (earliest
        // inPoint at the TOP of the stack, matching how they read
        // left-to-right in the parent comp's timeline). Without this the
        // frames are all present but stacked in the wrong order.
        sequenceOrderByTime(newComp);

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

// Re-stacks a comp's layers so they read in timeline order: earliest inPoint
// ends up at index 1 (top of the stack), latest at the bottom. Implemented
// with repeated moveToBeginning() rather than AE 2023+'s layer.move() -
// works on every CEP-supported version. Only touches layers that actually
// need moving, so undo history stays clean-ish.
function sequenceOrderByTime(targetComp) {
    // Snapshot (inPoint, current index) pairs, sorted by inPoint ascending.
    // Ties keep their existing relative stacking (stable sort).
    var entries = [];
    var i;
    for (i = 1; i <= targetComp.numLayers; i++) {
        entries.push({ index: i, inPoint: targetComp.layer(i).inPoint });
    }
    entries.sort(function (a, b) { return a.inPoint - b.inPoint; });

    // Resolve layer references BEFORE any moves happen (entries[].index was
    // captured up front, and each move renumbers the stack - but live layer
    // objects stay valid across moves). Then pull the layers to the TOP of
    // the stack in reverse desired order, so the earliest-inPoint layer ends
    // up at index 1 and the latest lands at the bottom - i.e. stacking
    // matches timeline order.
    var orderedLayers = [];
    for (i = 0; i < entries.length; i++) {
        orderedLayers.push(targetComp.layer(entries[i].index));
    }
    for (i = orderedLayers.length - 1; i >= 0; i--) {
        orderedLayers[i].moveToBeginning();
    }
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
