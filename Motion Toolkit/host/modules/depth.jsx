// Backend for the footer "DEPTH" button. Two entry points, both called from
// client/js/modules/depth.js:
//
//   depthGetJobInfo()        - reads the selected layer + project paths.
//                              Called BEFORE the background process starts.
//   depthImportResult(path)  - imports the finished depth map into the
//                              project. Called AFTER depth_runner.py exits.
//
// ExtendScript never runs the model itself - it can only read/write the AE
// project, and doing anything slow here (loading a neural net, waiting on a
// process) would freeze the whole After Effects UI. The actual inference
// happens out-of-process in host/python/depth_runner.py, kicked off and
// watched from the Node side (client/js/modules/depth.js). This file's only
// job is handing plain file paths back and forth across that boundary.
//
// Helper function names below are prefixed "depth" for the same reason
// sequence.jsx's are prefixed "sequence" (see that file) - every
// host/modules/*.jsx file shares one ExtendScript global namespace.

function depthGetJobInfo() {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        return JSON.stringify({ ok: false, message: "Select an active composition." });
    }

    var selected = comp.selectedLayers;
    if (selected.length === 0) {
        return JSON.stringify({ ok: false, message: "Select a layer with footage first." });
    }
    if (selected.length > 1) {
        return JSON.stringify({ ok: false, message: "Select exactly one layer for Depth." });
    }

    if (!app.project.file) {
        return JSON.stringify({ ok: false, message: "Save the project first - Depth needs a project folder to write into." });
    }

    var layer = selected[0];
    var file = depthGetLayerSourceFile(layer);
    if (!file) {
        return JSON.stringify({ ok: false, message: "Select a layer whose source is an image file (not a solid, text, comp, or offline footage)." });
    }

    // Depth Anything / MiDaS via transformers (see depth_runner.py) run on a
    // single still image. isStill === false covers both video and image
    // sequences - organize.jsx uses the same check to spot sequences.
    if (layer.source.mainSource.isStill === false) {
        return JSON.stringify({ ok: false, message: "\"" + layer.source.name + "\" is a video or image sequence - Depth currently supports single still images." });
    }

    var projectDir = app.project.file.parent.fsName;
    var depthDir = projectDir + "/DEPTH";

    return JSON.stringify({
        ok: true,
        sourcePath: file.fsName,
        projectDir: projectDir,
        depthDir: depthDir,
        layerName: layer.name
    });
}

// Returns the File for a layer's source footage, or null if the layer isn't
// a plain file-backed AVLayer (rules out solids, text, comps, missing/offline
// footage, and anything else with no file on disk).
function depthGetLayerSourceFile(layer) {
    if (!(layer instanceof AVLayer)) return null;
    if (!layer.source || !(layer.source instanceof FootageItem)) return null;

    var mainSource = layer.source.mainSource;
    if (!mainSource || !(mainSource instanceof FileSource)) return null;

    var file = mainSource.file;
    if (!file || !file.exists) return null;

    return file;
}

// Called once host/python/depth_runner.py has written its output file.
// Note the DEPTH output folder on disk (created by depth.js via Node's fs,
// since ExtendScript never touches it) is separate from this - importing
// just adds the finished file as a project item; it doesn't move anything.
function depthImportResult(filePath) {
    var result = { ok: false, message: "" };

    app.beginUndoGroup("Import Depth Map");
    try {
        var file = new File(filePath);
        if (!file.exists) {
            result.message = "Depth map file was not found on disk: " + filePath;
        } else {
            var importOptions = new ImportOptions(file);
            var newItem = app.project.importFile(importOptions);
            result.ok = true;
            result.message = "Imported \"" + newItem.name + "\".";
        }
    } catch (err) {
        result.message = "Import Error: " + err.toString();
    } finally {
        app.endUndoGroup();
    }

    return JSON.stringify(result);
}
