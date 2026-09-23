function listFfxPresets(folderPath) {
    var folder = new Folder(folderPath);
    var presets = [];

    collectFfxFiles(folder, presets, folder);
    presets.sort();
    return presets.join("\n");
}

function listCustomPresets(folderPath) {
    var folder = new Folder(folderPath);
    var presets = [];
    collectCustomPresets(folder, presets);
    presets.sort();
    return presets.join("\n");
}

function collectCustomPresets(folder, presets) {
    if (!folder || !folder.exists) return;
    var entries = folder.getFiles();
    for (var i = 0; i < entries.length; i++) {
        if (entries[i] instanceof Folder) {
            collectCustomPresets(entries[i], presets);
        } else if (entries[i] instanceof File && entries[i].name.toLowerCase().slice(-4) === ".ffx") {
            var baseName = entries[i].name.slice(0, -4);
            var image = findCustomImage(entries[i].parent, baseName);
            var descriptionFile = new File(entries[i].parent.fsName + "/" + baseName + ".txt");
            var description = "";
            if (descriptionFile.exists && descriptionFile.open("r")) {
                description = descriptionFile.read().replace(/[\r\n]+/g, " ");
                descriptionFile.close();
            }
            presets.push(entries[i].name + "\t" + entries[i].fsName + "\t" + (image ? image.fsName : "") + "\t" + description);
        }
    }
}

function findCustomImage(folder, baseName) {
    var extensions = [".png", ".jpg", ".jpeg", ".webp"];
    for (var i = 0; i < extensions.length; i++) {
        var image = new File(folder.fsName + "/" + baseName + extensions[i]);
        if (image.exists) return image;
    }
    return null;
}

function listAeBuiltinPresets() {
    var presets = [];
    var presetsFolders = getAeAnimationPresetFolders();

    if (presetsFolders.length === 0) {
        return "__AE_ANIMATION_PRESETS_FOLDER_NOT_FOUND__";
    }

    for (var i = 0; i < presetsFolders.length; i++) {
        collectFfxFiles(presetsFolders[i], presets, presetsFolders[i]);
    }
    presets.sort();
    return presets.join("\n");
}

function getAeAnimationPresetFolders() {
    var folders = [];
    var appFolder = new Folder(app.path);
    var candidates = [
        new Folder(appFolder.fsName + "/Presets"),
        new Folder(appFolder.fsName + "/Support Files/Presets"),
        new Folder(appFolder.parent.fsName + "/Presets"),
        new Folder(appFolder.parent.fsName + "/Support Files/Presets"),
        new Folder(appFolder.parent.parent.fsName + "/Presets"),
        new Folder(appFolder.parent.parent.fsName + "/Support Files/Presets")
    ];

    for (var i = 0; i < candidates.length; i++) {
        if (candidates[i].exists && !containsFolder(folders, candidates[i].fsName)) {
            folders.push(candidates[i]);
        }
    }

    var adobeFolder = appFolder.parent.parent;
    if (adobeFolder && adobeFolder.exists) {
        var installs = adobeFolder.getFiles();
        for (var installIndex = 0; installIndex < installs.length; installIndex++) {
            var install = installs[installIndex];
            if (!(install instanceof Folder) || install.name.toLowerCase().indexOf("after effects") === -1) {
                continue;
            }
            var installCandidates = [
                new Folder(install.fsName + "/Support Files/Presets"),
                new Folder(install.fsName + "/Presets")
            ];
            for (var candidateIndex = 0; candidateIndex < installCandidates.length; candidateIndex++) {
                var installFolder = installCandidates[candidateIndex];
                if (installFolder.exists && !containsFolder(folders, installFolder.fsName)) {
                    folders.push(installFolder);
                }
            }
        }
    }
    return folders;
}

function containsFolder(folders, folderPath) {
    for (var i = 0; i < folders.length; i++) {
        if (folders[i].fsName === folderPath) {
            return true;
        }
    }
    return false;
}

function collectFfxFiles(folder, presets, rootFolder) {
    if (!folder || !folder.exists) {
        return;
    }

    var entries = folder.getFiles();
    for (var i = 0; i < entries.length; i++) {
        if (entries[i] instanceof Folder) {
            collectFfxFiles(entries[i], presets, rootFolder);
        } else if (entries[i] instanceof File && entries[i].name.toLowerCase().slice(-4) === ".ffx") {
            addUniquePreset(presets, entries[i], rootFolder);
        }
    }

}

function addUniquePreset(presets, file, rootFolder) {
    var relativeFolder = file.parent.fsName.slice(rootFolder.fsName.length).replace(/^[\\\/]+/, "").replace(/\\/g, "/");
    var record = file.name + "\t" + file.fsName + "\t" + relativeFolder;
    for (var i = 0; i < presets.length; i++) {
        if (presets[i].split("\t")[1] === file.fsName) {
            return;
        }
    }
    presets.push(record);
}

function applyFfxPreset(presetPath) {
    var comp = app.project.activeItem;
    if (!comp || !(comp instanceof CompItem)) {
        alert("Select an active composition.");
        return;
    }

    var layers = comp.selectedLayers;
    if (layers.length === 0) {
        alert("Select at least one layer.");
        return;
    }

    var presetFile = new File(presetPath);
    if (!presetFile.exists) {
        alert("Preset file was not found:\n" + presetPath);
        return;
    }

    var originalTime = comp.time;
    var applyAtLayerStart = layers.length > 1;
    app.beginUndoGroup("Apply Animation Preset");

    try {
        for (var i = 0; i < layers.length; i++) {
            comp.time = applyAtLayerStart ? layers[i].inPoint : originalTime;
            layers[i].applyPreset(presetFile);
        }
    } catch (err) {
        alert("Apply Preset Error: " + err.toString());
    } finally {
        comp.time = originalTime;
        app.endUndoGroup();
        app.activate();
    }
}
