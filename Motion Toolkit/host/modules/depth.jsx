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
    var job = depthResolveJobSource(layer);
    if (!job.ok) {
        return JSON.stringify(job);
    }
    var file = job.file;
    var sourceKind = job.sourceKind;

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
        sourceName: file.name,
        framePattern: framePattern,
        firstFrameNumber: firstFrameNumber,
        projectDir: projectDir,
        depthDir: depthDir,
        layerName: layer.name,
        // Extra context the playback (RIFE) module needs; harmless for depth.
        compName: comp.name,
        layerInPoint: layer.inPoint,
        layerOutPoint: layer.outPoint,
        frameRate: comp.frameRate,
        // Precomp support: seconds between the selected layer's start and
        // the resolved child footage's start (0 when a plain footage layer
        // was selected). Playback uses it to trim/place the RIFE result so
        // it matches what the precomp actually showed.
        timeShift: job.timeShift || 0,
        note: job.note || ""
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

// Is this footage item an OFFLINE proxy whose real (relinked) file still
// lives on disk? AE reports a FileSource for proxies too, but mainSource.file
// may point at a missing/placeholder path while `proxyPath` remembers the
// original local media. We only accept it when that original actually exists
// on disk - i.e. "offline footage that is local footage stored in my storage".
function depthOfflineProxyFile(footageItem) {
    try {
        if (!footageItem.mainProxy) return null; // already using the real file
        var pp = footageItem.proxyPath;
        if (!pp) return null;
        var f = new File(pp);
        return f.exists ? f : null;
    } catch (err) {
        return null;
    }
}

// Shared source resolver for DEPTH and PLAY (RIFE). Returns
//   { ok:true, file, sourceKind, layer, timeShift, note }
// or { ok:false, message }.
//
// Accepts three kinds of selected layers:
//   1. A normal footage layer with an online file      -> as before.
//   2. An OFFLINE footage layer whose original file is still on disk
//      (found via proxyPath)                           -> uses that file.
//   3. A COMPOSITION / PRECOMP layer                   -> drills into the
//      precomp and finds its single dominant footage child (video or image
//      sequence). Nested precomps are searched recursively. The child's
//      effective start time inside the precomp is returned as `timeShift`
//      so callers can trim the result back to match the precomp's timing.
//
// Classifies the resolved file as still / video / sequence:
//   still   -> depth_runner.py         (one image in, one depth png out)
//   video   -> *_runner.py             (decoded per-frame @ 1080p default)
//   sequence-> *_runner.py             (frames globbed straight from disk)
function depthResolveJobSource(layer) {
    // --- Case 3: composition / precomp layer -----------------------------
    if (layer instanceof AVLayer && layer.source instanceof CompItem) {
        var found = depthFindPrecompFootage(layer.source, 0);
        if (!found) {
            return { ok: false, message: "That precomp contains no footage layer with a usable file on disk (solids/text/shapes and procedurally-rendered comps cannot be interpolated - render the precomp to a video first)." };
        }
        var inner = depthResolveJobSource(found.layer);
        if (!inner.ok) {
            return { ok: false, message: inner.message + " (inside precomp \"" + layer.source.name + "\")" };
        }
        inner.timeShift = found.startTime;
        inner.note = "Using footage \"" + inner.file.name + "\" found inside precomp \"" + layer.source.name + "\".";
        return inner;
    }

    // --- Cases 1 & 2: footage layer, online or offline-with-local-file ---
    if (layer instanceof AVLayer && layer.source instanceof FootageItem) {
        var file = null;
        try {
            if (layer.source.mainSource && (layer.source.mainSource instanceof FileSource)) {
                var f = layer.source.mainSource.file;
                if (f && f.exists) file = f;
            }
        } catch (err) { /* fall through to proxy check */ }

        if (!file) {
            file = depthOfflineProxyFile(layer.source);
            if (!file) {
                return { ok: false, message: "This layer's footage is offline and its original file was not found on disk. Relink it (or keep the source files where they were when first imported), or select a layer whose media is available." };
            }
        }

        var sourceKind = "still";
        try {
            if (layer.source.mainSource && layer.source.mainSource.isStill === false) {
                sourceKind = depthIsImageSequence(file.name) ? "sequence" : "video";
            } else if (depthIsImageSequence(file.name) === false) {
                sourceKind = "video"; // offline non-image file => treat as video container
            }
        } catch (err) {
            sourceKind = depthIsImageSequence(file.name) ? "sequence" : "video";
        }

        return { ok: true, file: file, sourceKind: sourceKind, layer: layer, timeShift: 0 };
    }

    return { ok: false, message: "Select a footage layer, an offline footage layer whose file is still on disk, or a precomp containing footage (not solids, text, or shape layers)." };
}

// Recursively searches a comp for the best footage candidate for RIFE/depth:
// prefers multi-frame sources (video / image sequence) over stills. Returns
// { layer, startTime } where startTime is the deepest child's inPoint shifted
// through every nesting level (seconds relative to the outer comp), or null.
function depthFindPrecompFootage(comp, depthSoFar) {
    if (depthSoFar > 8) return null; // guard against cyclic precomps
    var bestVideo = null, bestStill = null;
    for (var i = 1; i <= comp.numLayers; i++) {
        var lyr = comp.layer(i);
        var childStart = lyr.inPoint;
        if (lyr instanceof AVLayer && lyr.source instanceof CompItem) {
            var nested = depthFindPrecompFootage(lyr.source, depthSoFar + 1);
            if (nested) {
                nested.startTime = childStart + nested.startTime;
                // Treat a nested video candidate as a video candidate here.
                if (!bestVideo) bestVideo = nested;
            }
            continue;
        }
        if (lyr instanceof AVLayer && lyr.source instanceof FootageItem) {
            var isMulti = false;
            try { isMulti = (lyr.source.mainSource && lyr.source.mainSource.isStill === false); } catch (err) {}
            var cand = { layer: lyr, startTime: childStart };
            if (isMulti) { if (!bestVideo) bestVideo = cand; }
            else if (!bestStill) bestStill = cand;
        }
    }
    return bestVideo || bestStill;
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
