function setPropertyValueSmart(prop, value, time) {
    // setValue() only works on a property with no keyframes at all - calling
    // it on an already-animated anchorPoint throws "Can not call setValue()
    // on a property with keyframes". setValueAtTime() is the correct call
    // once there are keyframes: it updates the keyframe at `time` if one
    // already exists there, or inserts a new one if not. This is still the
    // right call specifically for Anchor Point, since the tool computes one
    // new target value from the CURRENT bounding box and only claims to be
    // setting the anchor "right now" - Position is different (see
    // compensatePosition below), because compensation needs to preserve
    // whatever animation Position already has, not just patch one instant.
    if (prop.numKeys > 0) {
        prop.setValueAtTime(time, value);
    } else {
        prop.setValue(value);
    }
}

function setSpatialValue(prop, newValue, is3D, time) {
    // Position and Anchor Point become "hidden" for setValue() once Separate
    // Dimensions is turned on for them - the live values move to per-axis
    // follower properties instead of the merged property. getSeparationFollower(dim)
    // (0=X, 1=Y, 2=Z) is the documented way to reach those followers. Each
    // follower is its own Property with its own independent keyframe state,
    // so the keyframed-or-not check has to happen per follower too.
    if (prop.dimensionsSeparated) {
        setPropertyValueSmart(prop.getSeparationFollower(0), newValue[0], time);
        setPropertyValueSmart(prop.getSeparationFollower(1), newValue[1], time);
        if (is3D) {
            setPropertyValueSmart(prop.getSeparationFollower(2), newValue[2], time);
        }
    } else {
        setPropertyValueSmart(prop, newValue, time);
    }
}

// The anchor-compensation delta depends on the layer's rotation and scale,
// which can themselves be animated - evaluating them at a specific time
// (rather than always using "right now") is what lets compensatePosition
// shift a Position keyframe correctly even if rotation/scale look different
// at that keyframe's own time than they do at the current playhead.
function rotatedDeltaAtTime(rawDeltaX, rawDeltaY, layer, time) {
    var rotationDegrees = 0;
    if (layer.rotation && typeof layer.rotation.valueAtTime === "function") {
        var rotationValue = layer.rotation.valueAtTime(time, false);
        if (typeof rotationValue === "number") rotationDegrees = rotationValue;
    }
    var scaleValue = layer.scale.valueAtTime(time, false);
    var radians = rotationDegrees * Math.PI / 180;
    var cos = Math.cos(radians);
    var sin = Math.sin(radians);
    var rotatedX = rawDeltaX * cos - rawDeltaY * sin;
    var rotatedY = rawDeltaX * sin + rawDeltaY * cos;
    return [rotatedX * (scaleValue[0] / 100), rotatedY * (scaleValue[1] / 100)];
}

function shiftMergedPositionKeyframes(prop, layer, rawDeltaX, rawDeltaY) {
    for (var keyIndex = 1; keyIndex <= prop.numKeys; keyIndex++) {
        var keyTime = prop.keyTime(keyIndex);
        var delta = rotatedDeltaAtTime(rawDeltaX, rawDeltaY, layer, keyTime);
        var existing = prop.keyValue(keyIndex);
        prop.setValueAtKey(keyIndex, [existing[0] + delta[0], existing[1] + delta[1], existing[2] || 0]);
    }
}

function shiftFollowerKeyframes(follower, layer, rawDeltaX, rawDeltaY, axisIndex) {
    for (var keyIndex = 1; keyIndex <= follower.numKeys; keyIndex++) {
        var keyTime = follower.keyTime(keyIndex);
        var delta = rotatedDeltaAtTime(rawDeltaX, rawDeltaY, layer, keyTime);
        follower.setValueAtKey(keyIndex, follower.keyValue(keyIndex) + delta[axisIndex]);
    }
}

// Compensates Position for the anchor point change. Unlike Anchor Point
// itself, this does not insert a new keyframe when Position is already
// animated: it shifts every keyframe Position already has (recomputing the
// delta at each keyframe's own time, so animated rotation/scale are still
// respected), which preserves the existing motion path instead of leaving
// an extra keyframe sitting at the current time.
function compensatePosition(layer, rawDeltaX, rawDeltaY, time) {
    var prop = layer.position;

    if (prop.dimensionsSeparated) {
        var xFollower = prop.getSeparationFollower(0);
        var yFollower = prop.getSeparationFollower(1);
        if (xFollower.numKeys > 0) {
            shiftFollowerKeyframes(xFollower, layer, rawDeltaX, rawDeltaY, 0);
        } else {
            xFollower.setValue(xFollower.value + rotatedDeltaAtTime(rawDeltaX, rawDeltaY, layer, time)[0]);
        }
        if (yFollower.numKeys > 0) {
            shiftFollowerKeyframes(yFollower, layer, rawDeltaX, rawDeltaY, 1);
        } else {
            yFollower.setValue(yFollower.value + rotatedDeltaAtTime(rawDeltaX, rawDeltaY, layer, time)[1]);
        }
        return;
    }

    if (prop.numKeys > 0) {
        shiftMergedPositionKeyframes(prop, layer, rawDeltaX, rawDeltaY);
        return;
    }

    var current = prop.value;
    var delta = rotatedDeltaAtTime(rawDeltaX, rawDeltaY, layer, time);
    prop.setValue([current[0] + delta[0], current[1] + delta[1], current[2] || 0]);
}

function setAnchorPoint(position) {
    app.beginUndoGroup("Move Anchor Point");
    try {
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

        for (var i = 0; i < layers.length; i++) {
            var layer = layers[i];
            var rect = layer.sourceRectAtTime(comp.time, false);

            var x = rect.left;
            var y = rect.top;

            // Position calculation for all 9 grid targets
            if (position === "top-left") {
                // x and y remain rect.left, rect.top
            } else if (position === "top-center") {
                x += rect.width / 2;
            } else if (position === "top-right") {
                x += rect.width;
            } else if (position === "middle-left") {
                y += rect.height / 2;
            } else if (position === "center") {
                x += rect.width / 2;
                y += rect.height / 2;
            } else if (position === "middle-right") {
                x += rect.width;
                y += rect.height / 2;
            } else if (position === "bottom-left") {
                y += rect.height;
            } else if (position === "bottom-center") {
                x += rect.width / 2;
                y += rect.height;
            } else if (position === "bottom-right") {
                x += rect.width;
                y += rect.height;
            }

            var oldAnchor = layer.anchorPoint.value;
            var newAnchor = [x, y, oldAnchor[2] || 0];
            var rawDeltaX = newAnchor[0] - oldAnchor[0];
            var rawDeltaY = newAnchor[1] - oldAnchor[1];

            var is3D = layer.threeDLayer;
            setSpatialValue(layer.anchorPoint, newAnchor, is3D, comp.time);
            compensatePosition(layer, rawDeltaX, rawDeltaY, comp.time);
        }
    } catch (err) {
        alert("Anchor Point Error: " + err.toString());
    } finally {
        app.endUndoGroup();
    }
}
