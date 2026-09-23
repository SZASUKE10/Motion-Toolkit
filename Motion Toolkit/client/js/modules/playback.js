/* Wires the footer "PLAY" button + speed dropdown (2x/4x/8x/16x) to RIFE
   frame interpolation via host/python/rife_runner.py.

   Flow for one click:
     1. evalScript depthGetJobInfo()   - shared with the DEPTH feature: reads
                                         the selected layer, classifies its
                                         source (still / video / sequence) and
                                         returns file paths + comp context.
                                         Stills make no sense to interpolate,
                                         so they are rejected here.
     2. mkdir <project>/RIFE/<name>_Nx, then spawn rife_runner.py with the
        multiplier from .speed-select and the model from depth-config.js
        (default: RIFE NVIDIA 4.0, alpha-safe). Runs on the GPU only - see
        requirements.txt which pins the cu121 NVIDIA wheels (RTX 3060).
     3. On close, evalScript playbackPlaceInterpolated() to import the new
        frames as ONE sequence footage item and drop it into the timeline
        directly above the original layer.

   Like depth.js, step 2 happens on Node's event loop so After Effects stays
   responsive while RIFE works. */
(() => {
  const csInterface = new CSInterface();
  const escapeScriptString = window.MotionToolkitUtil.escapeForEvalScript;
  let hostModulesLoaded = false;

  // Loads both depth.jsx (for depthGetJobInfo) and playback.jsx (for the
  // place step) in one go - they share a load-once flag because they're
  // always needed together by this feature.
  function loadPlaybackModules(onReady) {
    if (hostModulesLoaded) {
      onReady();
      return;
    }
    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    const depthPath = (extensionPath + '/host/modules/depth.jsx').replace(/\\/g, '/');
    const playbackPath = (extensionPath + '/host/modules/playback.jsx').replace(/\\/g, '/');

    csInterface.evalScript(
      `$.evalFile("${escapeScriptString(depthPath)}");$.evalFile("${escapeScriptString(playbackPath)}")`,
      (result) => {
        if (result && result.indexOf('EvalScript error') !== -1) {
          console.error('Failed to load playback host modules:', result);
          return;
        }
        hostModulesLoaded = true;
        onReady();
      }
    );
  }

  function parseHostResult(result, fallbackMessage) {
    if (result && result.indexOf('EvalScript error') !== -1) {
      return { ok: false, message: `${fallbackMessage}: ${result}` };
    }
    try {
      return JSON.parse(result);
    } catch (err) {
      return { ok: false, message: result || fallbackMessage };
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('.play-button');
    const speedSelect = document.querySelector('.speed-select');
    const statusLabel = document.querySelector('[data-playback-status]');
    if (!button) return;

    function setStatus(text, state) {
      if (!statusLabel) return;
      statusLabel.textContent = text;
      statusLabel.dataset.state = state || '';
      statusLabel.hidden = false;
    }

    if (typeof require !== 'function') {
      button.addEventListener('click', () => setStatus('Node.js is not enabled for this panel.', 'error'));
      return;
    }

    const fs = require('fs');
    const path = require('path');
    const python = window.MotionToolkitPython;

    let jobRunning = false;

    function finish(text, state) {
      jobRunning = false;
      button.disabled = false;
      setStatus(text, state);
    }

    button.addEventListener('click', () => {
      if (jobRunning) return;
      const multiplier = parseInt(speedSelect ? speedSelect.value : '2', 10) || 2;
      jobRunning = true;
      button.disabled = true;
      setStatus(`Reading selected layer... (${multiplier}x)`, '');

      loadPlaybackModules(() => {
        csInterface.evalScript('depthGetJobInfo()', (rawInfo) => {
          const info = parseHostResult(rawInfo, 'Could not read the selected layer');
          if (!info.ok) {
            finish(info.message, 'error');
            return;
          }
          if (info.sourceKind === 'still') {
            finish('A single still image has no frames to interpolate - select a video or image sequence.', 'error');
            return;
          }
          if (info.sourceKind === 'sequence' && !info.framePattern) {
            finish('Could not work out the image-sequence frame pattern for that layer.', 'error');
            return;
          }
          runInterpolationJob(info, multiplier);
        });
      });
    });

    function runInterpolationJob(info, multiplier) {
      const config = window.MotionToolkitDepthConfig;
      const model = config.getRifeModel();
      const resolution = config.getResolution();
      const baseName = path.parse(info.sourcePath).name;
      const outDir = path.join(info.projectDir, 'RIFE', `${baseName}_${multiplier}x`);
      let latestStdout = '';

      try {
        fs.mkdirSync(outDir, { recursive: true });
      } catch (err) {
        finish(`Could not prepare the RIFE folder: ${err.message}`, 'error');
        return;
      }

      const args = [
        '--input', info.sourcePath,
        '--output-dir', outDir,
        '--multiplier', String(multiplier),
        '--model', model,
        '--scale', String(resolution),
        '--prefix', 'interp',
        '--ext', 'png'
      ];
      if (info.sourceKind === 'sequence') {
        args.push('--frame-pattern', info.framePattern);
        args.push('--start-number', String(info.firstFrameNumber || 0));
      }

      setStatus(`Interpolating ${multiplier}x (${model}, CUDA)...`, '');

      python.runPythonScript(csInterface, 'rife_runner.py', args, {
        onStdout: (text) => {
          latestStdout += text;
          const progress = python.lastProgress(latestStdout);
          if (progress) {
            setStatus(`RIFE pass frame ${progress.done}/${progress.total} (${multiplier}x)...`, '');
          }
        },
        onError: (message) => finish(message, 'error'),
        onClose: (code) => {
          let frameCount = 0;
          try {
            frameCount = fs.readdirSync(outDir).filter((n) => n.startsWith('interp_')).length;
          } catch (err) {
            frameCount = 0;
          }
          if (code !== 0 || frameCount === 0) {
            finish(`Interpolation failed (see console). Exit code ${code}.`, 'error');
            return;
          }

          setStatus(`Importing ${frameCount}-frame interpolated sequence...`, '');
          const aeGlob = path.join(outDir, 'interp_#.png').replace(/\\/g, '/');
          const seqName = `${baseName}_RIFE_${multiplier}x`;
          loadPlaybackModules(() => {
            csInterface.evalScript(
              `playbackPlaceInterpolated("${escapeScriptString(aeGlob)}", "${escapeScriptString(seqName)}", "${escapeScriptString(info.sourcePath)}", ${multiplier})`,
              (rawResult) => {
                const result = parseHostResult(rawResult, 'Could not place the interpolated sequence');
                finish(result.message, result.ok ? 'success' : 'error');
              }
            );
          });
        }
      });
    }
  });
})();
