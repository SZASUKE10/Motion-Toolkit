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

        // 2. Compute the butt-sequenced timeline BEFORE moving anything.
        // Frame N starts at N / frameRate - i.e. the sequence always begins
        // at time 0 of the comp, like Adobe's own Scripts > Sequence Layers.
        // (Previously we shifted layers onto each other while preserving the
        // first layer's original start time, then trimmed the precomp to that
        // offset span - which, combined with the old absolute-time reordering
        // pass below, could leave every layer pushed past the end of the
        // precomp's work area, i.e. invisible in the preview.)
        var sequenceEnd = layers.length * frameDuration;
        var indices = [];
        for (i = 0; i < layers.length; i++) indices.push(layers[i].index);

        // 3. Precompose FIRST, while the layers are still untouched.
        // moveAllAttributes must be true here regardless - AE only allows
        // false when precomposing a single layer.
        //
        // Why precompose before sequencing: precompose() copies the layers
        // into the new comp keeping their CURRENT timeline positions, so any
        // positions we set beforehand can land outside the new comp's work
        // area (the classic "everything sits beyond the last frame" bug). By
        // precomposing first and then positioning the layers INSIDE the
        // precomp relative to its own time 0, the sequence is guaranteed to
        // live within the comp.
        //
        // Note on stacking: precompose() keeps the parent's stacking order
        // inside the new comp, so layer indices may NOT correspond to
        // sequence order. That's fine - we address layers by identity via
        // the returned ItemCollection (indices[k] maps to newComp.layers.item(k))
        // and do NOT reorder the stack afterwards. For non-overlapping
        // 1-frame layers, stacking order has zero effect on the preview;
        // re-stacking was what previously corrupted positions.
        var compName = sequenceGetUniqueName("Sequence Precomp");
        var movedLayers = comp.layers.precompose(indices, compName, true);

        // 4. Inside the precomp, place frame k at [k*fd, (k+1)*fd).
        // Setting inPoint directly is safe because every layer is exactly one
        // frame long, so no in/out crossover is possible.
        var newComp = app.project.items.itemByName(compName);
        if (!(newComp instanceof CompItem)) {
            throw new Error("Precomposed comp \"" + compName + "\" not found.");
        }
        for (i = 0; i < movedLayers.length; i++) {
            movedLayers.item(i + 1).inPoint = i * frameDuration;
        }
        newComp.workAreaStart = 0;
        newComp.workAreaDuration = sequenceEnd;

        // 5. Back in the parent comp, trim the layer representing the
        // precomp to exactly the sequence span, starting at time 0.
        var outerLayer = sequenceFindLayerBySource(comp, newComp);
        if (outerLayer) {
            outerLayer.startTime = 0;
            outerLayer.inPoint = 0;
            outerLayer.outPoint = sequenceEnd;
        }

        result.ok = true;
        result.message = layers.length + " layer" + (layers.length === 1 ? "" : "s") +
            " sequenced into \"" + newComp.name + "\" (" +
            layers.length + " frames @ " + comp.frameRate + " fps).";
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

// Re-stacks a comp's layers so they read in timeline order. NOTE: no longer
// used by sequenceSelectedLayers() - for non-overlapping 1-frame layers the
// stacking order has no effect on the preview, and re-stacking was found to
// corrupt layer positions. Kept as a utility only; safe to delete.
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
