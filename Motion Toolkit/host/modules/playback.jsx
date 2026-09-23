// Backend for the footer "PLAY" (RIFE interpolation) button. Called from
// client/js/modules/playback.js. Two entry points:
//
//   playbackPlaceInterpolated(aeGlob, seqName, sourcePath, multiplier, timeShift)
//       - imports the finished interpolated frame sequence as ONE footage
//         item and drops it into the active comp directly above the layer
//         whose source we interpolated, time-stretched by `multiplier` so it
//         plays back at normal speed with the new smooth frames underneath.
//         `timeShift` (seconds) is how far inside the selected layer the
//         resolved source file started - non-zero when a PRECOMP was
//         selected; used to trim the placed layer so it lines up with what
//         the precomp actually displayed.
//
// The job-info step is shared with depth.jsx's depthGetJobInfo() (same layer
// classification + file paths, plus comp/inPoint/frameRate context), so this
// file only handles the import-and-place half of the flow.

function playbackFindSourceLayer(comp, sourcePath) {
    // Match on the source file path returned by depthGetJobInfo() so we can
    // re-resolve the layer even if selection changed while RIFE was running.
    // Checks plain footage layers AND offline footage whose proxyPath still
    // points at the same local file (depthResolveJobSource may have used it).
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        var lyr = comp.layer(i);
        try {
            if (!lyr.source || !(lyr.source instanceof FootageItem)) continue;
            var f = null;
            try {
                if (lyr.source.mainSource && (lyr.source.mainSource instanceof FileSource)) {
                    f = lyr.source.mainSource.file;
                }
            } catch (err) { /* offline mainSource may throw */ }
            if (f && f.fsName === sourcePath) return lyr;
            var pp = lyr.source.proxyPath;
            if (pp && String(pp) === sourcePath) return lyr;
        } catch (err) {
            // Property/shape/null layers have no usable source - skip.
            continue;
        }
    }
    return null;
}

function playbackPlaceInterpolated(globPath, seqName, sourcePath, multiplier, timeShift) {
    var result = { ok: false, message: "" };
    if (typeof timeShift !== "number" || !isFinite(timeShift)) timeShift = 0;

    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ ok: false, message: "Open the composition before placing the interpolated clip." });
    }

    app.beginUndoGroup("Place Interpolated Clip");
    try {
        var probe = new File(globPath.replace(/#/g, "0"));
        if (!probe.exists) {
            var dirPath = globPath.substring(0, globPath.lastIndexOf("/"));
            if (!new File(dirPath).exists) {
                result.message = "Interpolated sequence folder not found: " + dirPath;
            } else {
                result.message = "No interpolated frames matching " + globPath;
            }
        } else {
            var newItem = app.project.importFile(new ImportOptions(new File(globPath)));
            if (seqName) newItem.name = seqName;

            // Place above the original layer where possible, else top of stack.
            var anchor = playbackFindSourceLayer(comp, sourcePath);
            var newLayer;
            var anchorLayer = null;
            if (anchor) {
                anchorLayer = anchor;
                newLayer = comp.layers.add(newItem, anchor.inPoint);
                newLayer.moveTo(anchor); // inserts directly above the anchor
            } else {
                // Precomp case: the selected layer lives in the parent comp
                // (activeItem may have changed while RIFE rendered). Search
                // the whole project for the layer whose SOURCE FILE matches
                // sourcePath's containing layer - but simplest robust path:
                // just add at the timeline start of the active comp.
                newLayer = comp.layers.add(newItem);
            }

            // Precomp timing: the interpolated sequence covers the CHILD
            // footage from its own start, but the precomp only showed it
            // starting `timeShift` seconds later. Offset the layer's start
            // and trim off the leading frames that were never visible.
            if (timeShift > 0) {
                newLayer.startTime = newLayer.startTime + timeShift;
                newLayer.inPoint = newLayer.inPoint + timeShift;
            }

            // Time-remap stretch: N times more frames covering the same wall
            // duration == playback at normal speed but N times smoother.
            if (multiplier > 1) {
                newLayer.timeRemapEnabled = true;
                newLayer.property("Time Remap").setValueAtTime(0, 1 / multiplier);
                newLayer.property("Time Remap").setValueAtTime(newItem.duration, 1 / multiplier);
            }

            result.ok = true;
            result.message = "Placed \"" + newItem.name + "\" (" + multiplier + "x RIFE)" +
                (anchorLayer ? " above \"" + anchorLayer.name + "\"" : " at the timeline start") +
                (timeShift > 0 ? ", trimmed to match the precomp timing." : ".");
        }
    } catch (err) {
        result.message = "Place Error: " + err.toString();
    } finally {
        app.endUndoGroup();
    }

    return JSON.stringify(result);
}
