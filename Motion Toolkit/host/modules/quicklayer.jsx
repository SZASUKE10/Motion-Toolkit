function createQuickLayer(layerType, parentSelected, make3D) {
	var comp = app.project.activeItem;
	if (!comp || !(comp instanceof CompItem)) {
		alert("Select an active composition.");
		return;
	}

	app.beginUndoGroup("Create " + layerType + " Layer");

	try {
		var openCameraSettings = false;
		var center = [comp.width / 2, comp.height / 2];
		var selectedLayers = comp.selectedLayers;
		var targets = [];
		var createdLayers = [];

		if (selectedLayers.length === 0) {
			targets.push(null);
		} else {
			for (var targetIndex = 0; targetIndex < selectedLayers.length; targetIndex++) {
				targets.push(selectedLayers[targetIndex]);
			}
		}

		for (var targetPosition = 0; targetPosition < targets.length; targetPosition++) {
			var targetLayer = targets[targetPosition];
			var layer;
			var layerStartTime = targetLayer ? targetLayer.startTime : comp.displayStartTime;
			var layerInPoint = targetLayer ? targetLayer.inPoint : comp.displayStartTime;
			var layerOutPoint = targetLayer
				? targetLayer.outPoint
				: comp.displayStartTime + comp.duration;
			var layerDuration = layerOutPoint - layerInPoint;

			if (layerType === "Adjustment") {
				layer = comp.layers.addSolid([1, 1, 1], "Adjustment Layer", comp.width, comp.height, comp.pixelAspect, layerDuration);
				layer.adjustmentLayer = true;
			} else if (layerType === "Null") {
				layer = comp.layers.addNull();
			} else if (layerType === "Camera") {
				layer = comp.layers.addCamera("Camera", center);
				openCameraSettings = true;
			} else if (layerType === "Solid") {
				var color = [Math.random(), Math.random(), Math.random()];
				// The solid itself stays pure white - white has full luminance
				// everywhere, so Tint's "Map White To" reproduces the random
				// color exactly. A randomly-colored solid run through the same
				// Tint would have its own (non-full) luminance remapped too,
				// distorting the result instead of just showing the color.
				layer = comp.layers.addSolid([1, 1, 1], "Solid", comp.width, comp.height, 1, layerDuration);

				var effects = layer.property("ADBE Effect Parade");
				var tint = effects.addProperty("ADBE Tint");
				tint.property("Map White To").setValue(color);
			} else if (layerType === "Text") {
				layer = comp.layers.addText("text");
			} else if (layerType === "Shape") {
				layer = comp.layers.addShape();
			}

			if (!layer) {
				alert("Unsupported layer type: " + layerType);
				return;
			}

			layer.startTime = layerStartTime;
			layer.inPoint = layerInPoint;
			layer.outPoint = layerOutPoint;
			layer.label = getDefaultLayerLabel(layerType);

			if (make3D && layerType !== "Camera") {
				// CameraLayer objects don't expose threeDLayer at all (cameras
				// are inherently 3D already) - setting it throws, so this used
				// to error out whenever "3D Layer" was checked and CAM was
				// clicked. Nulls/Solids/Text/Shape are AVLayer and support it fine.
				layer.threeDLayer = true;
			}

			if (parentSelected && targetLayer) {
				// The new layer is meant to act as the controller here (e.g.
				// "select a layer, create a Null, parent that layer to the new
				// Null"), so the pre-existing selected layer becomes the child
				// of the new one - not the other way around.
				targetLayer.parent = layer;
			}

			if (targetLayer) {
				layer.moveBefore(targetLayer);
			}

			createdLayers.push(layer);
		}

		for (var layerIndex = 1; layerIndex <= comp.numLayers; layerIndex++) {
			comp.layer(layerIndex).selected = false;
		}
		for (var createdIndex = 0; createdIndex < createdLayers.length; createdIndex++) {
			createdLayers[createdIndex].selected = true;
		}
	} catch (err) {
		alert("Quick Layer Error: " + err.toString());
	} finally {
		app.endUndoGroup();
	}

	if (openCameraSettings) {
		for (var cameraLayerIndex = 1; cameraLayerIndex <= comp.numLayers; cameraLayerIndex++) {
			comp.layer(cameraLayerIndex).selected = false;
		}
		createdLayers[createdLayers.length - 1].selected = true;
		var cameraSettingsCommand = app.findMenuCommandId("Camera Settings...");
		if (cameraSettingsCommand > 0) {
			app.executeCommand(cameraSettingsCommand);
		} else {
			alert("Camera Settings command is unavailable.");
		}
	} else {
		app.activate();
	}
}

function getDefaultLayerLabel(layerType) {
	// Matches the layer defaults from the After Effects Label Defaults settings.
	if (layerType === "Camera") return 4;      // Pink
	if (layerType === "Adjustment") return 5; // Lavender
	if (layerType === "Shape") return 8;      // Blue
	return 1;                                  // Red: Solid, Null, and Text
}
