// Sorts every item in the Project panel into a folder based on its type:
//   Compositions        -> "Comp"
//   video footage       -> "Videos"  (.mp4, .mov, .avi, .mkv, .webm, .m4v,
//                                      .mxf, .wmv, .mts/.m2ts - case-insensitive)
//   image sequences     -> "Flowframe"
//   audio footage       -> "sound"   (.mp3, .wav, .aif/.aiff, .m4a, .aac, .flac, .ogg)
// Anything else (stills, solids, unknown formats) is left where it is.

function organizeProject() {
	if (!app.project) {
		alert("No project is open.");
		return "";
	}

	var counts = { Comp: 0, Videos: 0, Flowframe: 0, sound: 0 };

	app.beginUndoGroup("Organize Project");

	try {
		var compFolder = getOrCreateFolder("Comp");
		var videosFolder = getOrCreateFolder("Videos");
		var flowframeFolder = getOrCreateFolder("Flowframe");
		var soundFolder = getOrCreateFolder("sound");

		// Snapshot items first - we're about to reparent some of them, and
		// project.numItems / project.item(i) stay stable either way, but
		// working off a fixed list is easier to reason about.
		var items = [];
		var itemIndex;
		for (itemIndex = 1; itemIndex <= app.project.numItems; itemIndex++) {
			items.push(app.project.item(itemIndex));
		}

		for (var index = 0; index < items.length; index++) {
			var item = items[index];

			if (item instanceof FolderItem) continue;

			if (item instanceof CompItem) {
				moveIfNeeded(item, compFolder, counts, "Comp");
				continue;
			}

			if (item instanceof FootageItem && item.mainSource instanceof FileSource) {
				var file = item.mainSource.file;
				if (!file) continue;

				var lowerName = file.name.toLowerCase();
				var dot = lowerName.lastIndexOf(".");
				var ext = dot >= 0 ? lowerName.substring(dot + 1) : "";

				if (isVideoExtension(ext)) {
					// Container extensions are unambiguous - a .MOV is a video
					// regardless of how AE reports isStill. Checked BEFORE the
					// image-sequence test so QuickTime files never fall through.
					moveIfNeeded(item, videosFolder, counts, "Videos");
				} else if (isAudioExtension(ext)) {
					moveIfNeeded(item, soundFolder, counts, "sound");
				} else if (isImageExtension(ext) && item.mainSource.isStill === false) {
					// isStill === false + an image extension means multiple frames
					// were imported together - i.e. an image sequence, not a
					// single still.
					moveIfNeeded(item, flowframeFolder, counts, "Flowframe");
				} else if (!isImageExtension(ext) && item.mainSource.isStill === false) {
					// Unknown/extension-less source that holds multiple frames
					// (e.g. native-codec footage) - treat it as video too.
					moveIfNeeded(item, videosFolder, counts, "Videos");
				}
			}
		}
	} catch (err) {
		alert("Organize Error: " + err.toString());
	} finally {
		app.endUndoGroup();
	}

	return "Comp " + counts.Comp + " \u00b7 Videos " + counts.Videos + " \u00b7 Flowframe " + counts.Flowframe + " \u00b7 sound " + counts.sound;
}

function moveIfNeeded(item, targetFolder, counts, key) {
	if (item.parentFolder !== targetFolder) {
		item.parentFolder = targetFolder;
		counts[key]++;
	}
}

function getOrCreateFolder(name) {
	for (var i = 1; i <= app.project.numItems; i++) {
		var candidate = app.project.item(i);
		if (candidate instanceof FolderItem && candidate.name === name) {
			return candidate;
		}
	}
	return app.project.items.addFolder(name);
}

function isImageExtension(ext) {
	var imageExts = ["png", "jpg", "jpeg", "tif", "tiff", "exr", "tga", "dpx", "psd", "gif", "bmp"];
	for (var i = 0; i < imageExts.length; i++) {
		if (imageExts[i] === ext) return true;
	}
	return false;
}

// Video containers AE can import as footage. ".mov" was the bug: the old
// code only matched "mp4", so QuickTime files (the most common AE video
// format) were never detected and stayed out of the Videos folder.
function isVideoExtension(ext) {
	var videoExts = [
		"mp4", "mov", "m4v", "avi", "mkv", "webm", "wmv", "flv",
		"mxf", "mts", "m2ts", "mpg", "mpeg", "ogv", "3gp", "insv", "r3d"
	];
	for (var i = 0; i < videoExts.length; i++) {
		if (videoExts[i] === ext) return true;
	}
	return false;
}

function isAudioExtension(ext) {
	var audioExts = ["mp3", "wav", "aif", "aiff", "m4a", "aac", "flac", "ogg", "wma"];
	for (var i = 0; i < audioExts.length; i++) {
		if (audioExts[i] === ext) return true;
	}
	return false;
}
