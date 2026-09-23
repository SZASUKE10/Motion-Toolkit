// Backend for the footer "PLAY" (RIFE interpolation) button. Called from
// client/js/modules/playback.js. Two entry points:
//
//   playbackPlaceInterpolated(aeGlob, seqName, inPoint, multiplier)
//       - imports the finished interpolated frame sequence as ONE footage
//         item and drops it into the active comp directly above the layer
//         whose source we interpolated, time-stretched by `multiplier` so it
//         plays back at normal speed with the new smooth frames underneath.
//
// The job-info step is shared with depth.jsx's depthGetJobInfo() (same layer
// classification + file paths, plus comp/inPoint/frameRate context), so this
// file only handles the import-and-place half of the flow.

function playbackFindSourceLayer(comp, sourcePath) {
    // Match on the source file path returned by depthGetJobInfo() so we can
    // re-resolve the layer even if selection changed while RIFE was running.
    var i;
    for (i = 1; i <= comp.numLayers; i++) {
        var lyr = comp.layer(i);
        try {
            if (!lyr.source || !(lyr.source instanceof FootageItem)) continue;
            var f = lyr.source.mainSource.file;
            if (f && f.fsName === sourcePath) return lyr;
        } catch (err) {
            // Property/shape/null layers have no mainSource.file - skip.
            continue;
        }
    }
    return null;
}

function playbackPlaceInterpolated(globPath, seqName, sourcePath, multiplier) {
    var result = { ok: false, message: "" };

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
            if (anchor) {
                newLayer = comp.layers.add(newItem, anchor.inPoint);
                newLayer.moveTo(anchor); // inserts directly above the anchor
            } else {
                newLayer = comp.layers.add(newItem);
            }

            // Time-remap stretch: N times more frames covering the same wall
            // duration == playback at normal speed but N times smoother.
            if (multiplier > 1) {
                newLayer.timeRemapEnabled = true;
                newLayer.property("Time Remap").setValueAtTime(0, 1 / multiplier);
                newLayer.property("Time Remap").setValueAtTime(newItem.duration, 1 / multiplier);
            }

            result.ok = true;
            result.message = "Placed \"" + newItem.name + "\" (" + multiplier + "x RIFE) above " +
                (anchor ? "\"" + anchor.name + "\"" : "the timeline start") + ".";
        }
    } catch (err) {
        result.message = "Place Error: " + err.toString();
    } finally {
        app.endUndoGroup();
    }

    return JSON.stringify(result);
}
