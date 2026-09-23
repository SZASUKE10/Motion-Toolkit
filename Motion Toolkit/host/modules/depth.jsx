// Backend for the footer "DEPTH" button. Three entry points, all called from
// client/js/modules/depth.js:
//
//   depthGetJobInfo()            - reads the selected layer + project paths
//                                  and classifies its source as still /
//                                  video / sequence. Called BEFORE the
//                                  background process starts.
//   depthImportResult(path)      - imports a finished single depth map.
//   depthImportSequenceResult(
//       dir, pattern, name)      - imports a finished depth image sequence.
//
// Still images run through host/python/depth_runner.py; videos and image
// sequences run through host/python/video_depth_runner.py (1080p default,
// see client/js/lib/depth-config.js). ExtendScript never runs the model
// itself - it can only read/write the AE project, and doing anything slow
// here would freeze the whole After Effects UI. The actual inference happens
// out-of-process, kicked off and watched from the Node side
// (client/js/modules/depth.js). This file's only job is handing plain file
// paths back and forth across that boundary.
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
        return JSON.stringify({ ok: false, message: "Select a layer whose source is an image or video file (not a solid, text, comp, or offline footage)." });
    }

    // Classify the source so the Node side picks the right runner:
    //   still   -> depth_runner.py         (one image in, one depth png out)
    //   video   -> video_depth_runner.py   (decoded per-frame @ 1080p default)
    //   sequence-> video_depth_runner.py   (frames globbed straight from disk)
    //
    // Image sequences are detected the same way organize.jsx does it:
    // image extension + isStill === false means multiple frames were
    // imported together. Everything else non-still is treated as a video.
    var sourceKind = "still";
    if (layer.source.mainSource.isStill === false) {
        sourceKind = depthIsImageSequence(file.name) ? "sequence" : "video";
    }

    var projectDir = app.project.file.parent.fsName;
    var depthDir = projectDir + "/DEPTH";

    // For sequences, hand back a shell glob covering every frame on disk.
    // "*" (not "#") because this pattern is consumed by Python's glob in
    // video_depth_runner.py, not by AE's own sequence parser.
    var framePattern = null;
    var firstFrameNumber = 0;
    if (sourceKind === "sequence") {
        var parsed = depthParseSequenceFileName(file.name);
        if (parsed) {
            framePattern = file.parent.fsName + "/" + parsed.prefix + "*" + parsed.suffix;
            firstFrameNumber = parsed.number;
        } else {
            // No digits in the filename - fall back to matching every file
            // with the same extension in the same folder.
            framePattern = file.parent.fsName + "/*." + depthExtensionOf(file.name);
        }
    }

    return JSON.stringify({
        ok: true,
        sourceKind: sourceKind,
        sourcePath: file.fsName,
        sourceName: layer.source.name,
        framePattern: framePattern,
        firstFrameNumber: firstFrameNumber,
        projectDir: projectDir,
        depthDir: depthDir,
        layerName: layer.name
    });
}

var DEPTH_IMAGE_EXTS = ["png", "jpg", "jpeg", "tif", "tiff", "exr", "tga", "dpx", "psd", "gif", "bmp"];

function depthExtensionOf(name) {
    var lower = String(name).toLowerCase();
    var dot = lower.lastIndexOf(".");
    return dot >= 0 ? lower.substring(dot + 1) : "";
}

function depthIsImageSequence(fileName) {
    return DEPTH_IMAGE_EXTS.indexOf(depthExtensionOf(fileName)) !== -1;
}

// Splits "render_0042.png" into { prefix:"render_", number:42,
// suffix:".png" } so callers can build a "<dir>/render_*.png" glob and know
// what frame number the sequence starts at. Returns null when the name has
// no digits at all.
function depthParseSequenceFileName(fileName) {
    var name = String(fileName);
    var dot = name.lastIndexOf(".");
    var stem = dot >= 0 ? name.substring(0, dot) : name;
    var ext = dot >= 0 ? name.substring(dot) : "";

    var match = /(.*?)(\d+)$/.exec(stem);
    if (!match) return null;

    return {
        prefix: match[1],
        number: parseInt(match[2], 10),
        digitCount: match[2].length,
        suffix: ext
    };
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

// Called once video_depth_runner.py has written a full depth frame sequence.
// `globPath` uses AE's own "#" wildcard convention (e.g.
// ".../DEPTH/foo/depth_#.png"), which importFile resolves into a single
// multi-frame FootageItem - i.e. an image sequence, not N separate files.
// `seqName` is the display name given to the imported item.
function depthImportSequenceResult(globPath, seqName) {
    var result = { ok: false, message: "" };

    app.beginUndoGroup("Import Depth Sequence");
    try {
        var probe = new File(globPath.replace(/#/g, "0"));
        if (!probe.exists) {
            // Fall back to checking the folder itself exists - the frame
            // numbering may not start at 0.
            var dirPath = globPath.substring(0, globPath.lastIndexOf("/"));
            if (!new File(dirPath).exists) {
                result.message = "Depth sequence folder was not found on disk: " + dirPath;
            } else {
                result.message = "No depth frames matching " + globPath;
            }
        } else {
            var importOptions = new ImportOptions(new File(globPath));
            var newItem = app.project.importFile(importOptions);
            if (seqName) newItem.name = seqName;
            result.ok = true;
            result.message = "Imported sequence \"" + newItem.name + "\" (" + newItem.duration + "s).";
        }
    } catch (err) {
        result.message = "Import Error: " + err.toString();
    } finally {
        app.endUndoGroup();
    }

    return JSON.stringify(result);
}
