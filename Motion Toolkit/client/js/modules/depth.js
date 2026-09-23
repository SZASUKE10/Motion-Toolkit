/* Wires the footer "DEPTH" button to host/modules/depth.jsx and the Python
   runners under host/python/.

   Flow for one click:
     1. evalScript depthGetJobInfo()      -> selected layer's source path,
                                              source kind (still / video /
                                              sequence), project folder.
     2. fs.mkdirSync the DEPTH output folder, then spawn either
        depth_runner.py (stills) or video_depth_runner.py (videos + image
        sequences, 1080p default) against it.
     3. On the child process's "close" event, evalScript depthImportResult()
        (still) or depthImportSequenceResult() (video/sequence) to bring the
        finished file(s) back into the AE project.

   Step 2 runs on Node's event loop, not ExtendScript's - child_process.spawn
   returns immediately and the model runs in its own OS process, so neither
   the panel nor the After Effects UI thread blocks while it works. */
(() => {
  const csInterface = new CSInterface();
  const escapeScriptString = window.MotionToolkitUtil.escapeForEvalScript;
  let hostModuleLoaded = false;

  function loadDepthModule(onReady) {
    if (hostModuleLoaded) {
      onReady();
      return;
    }
    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    const scriptPath = (extensionPath + '/host/modules/depth.jsx').replace(/\\/g, '/');

    csInterface.evalScript(`$.evalFile("${escapeScriptString(scriptPath)}")`, (result) => {
      if (result && result.indexOf('EvalScript error') !== -1) {
        console.error('Failed to load depth.jsx:', result, scriptPath);
        return;
      }
      hostModuleLoaded = true;
      onReady();
    });
  }

  // Shared between depthGetJobInfo() and depthImport*Result() results below -
  // both follow graph-engine.jsx's {ok, message} convention.
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
    loadDepthModule(() => {});

    const button = document.querySelector('[data-depth-button]');
    const statusLabel = document.querySelector('[data-playback-status]');
    if (!button) return;

    function setStatus(text, state) {
      if (!statusLabel) return;
      statusLabel.textContent = text;
      statusLabel.dataset.state = state || '';
      statusLabel.hidden = false;
    }

    if (typeof require !== 'function') {
      // --enable-nodejs is set in CSXS/manifest.xml, so this should never be
      // hit in practice - kept as a clear failure message instead of a
      // silent no-op in case Node integration is ever turned off.
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
      jobRunning = true;
      button.disabled = true;
      setStatus('Reading selected layer...', '');

      loadDepthModule(() => {
        csInterface.evalScript('depthGetJobInfo()', (rawInfo) => {
          const info = parseHostResult(rawInfo, 'Could not read the selected layer');
          if (!info.ok) {
            finish(info.message, 'error');
            return;
          }
          if (info.sourceKind === 'sequence' && !info.framePattern) {
            finish('Could not work out the image-sequence frame pattern for that layer.', 'error');
            return;
          }
          runDepthJob(info);
        });
      });
    });

    function runDepthJob(info) {
      const config = window.MotionToolkitDepthConfig;
      const model = config.getSelectedModel();
      const baseName = path.parse(info.sourcePath).name;

      if (info.sourceKind === 'still') {
        runStillJob(info, model, baseName);
      } else {
        runSequenceJob(info, model, baseName);
      }
    }

    // Single image -> single depth png (original behaviour).
    function runStillJob(info, model, baseName) {
      let outputPath;
      try {
        fs.mkdirSync(info.depthDir, { recursive: true });
        outputPath = path.join(info.depthDir, `${baseName}_depth.png`);
      } catch (err) {
        finish(`Could not prepare the DEPTH folder: ${err.message}`, 'error');
        return;
      }

      setStatus(`Generating depth map (${model})...`, '');

      python.runPythonScript(csInterface, 'depth_runner.py', [
        '--input', info.sourcePath,
        '--output', outputPath,
        '--model', model
      ], {
        onError: (message) => finish(message, 'error'),
        onClose: (code) => {
          if (code !== 0 || !fs.existsSync(outputPath)) {
            finish(`Depth generation failed (see console). Exit code ${code}.`, 'error');
            return;
          }
          setStatus('Importing depth map...', '');
          loadDepthModule(() => {
            csInterface.evalScript(`depthImportResult("${escapeScriptString(outputPath)}")`, (rawResult) => {
              const result = parseHostResult(rawResult, 'Could not import the depth map');
              finish(result.message, result.ok ? 'success' : 'error');
            });
          });
        }
      });
    }

    // Video / image sequence -> DEPTH/<name>_DEPTH/ with numbered frames,
    // re-imported as a single sequence footage item. Videos are decoded at
    // the configured resolution (1080p by default); sequences keep their
    // native frame size.
    function runSequenceJob(info, model, baseName) {
      const config = window.MotionToolkitDepthConfig;
      const resolution = config.getResolution();
      const outDir = path.join(info.depthDir, `${baseName}_DEPTH`);
      let latestStdout = '';

      try {
        fs.mkdirSync(outDir, { recursive: true });
      } catch (err) {
        finish(`Could not prepare the DEPTH folder: ${err.message}`, 'error');
        return;
      }

      const isVideo = info.sourceKind === 'video';
      const args = [
        '--input', info.sourcePath,
        '--output-dir', outDir,
        '--model', model,
        '--prefix', 'depth',
        '--ext', 'png'
      ];
      if (isVideo) {
        args.push('--scale', String(resolution));
      } else {
        args.push('--frame-pattern', info.framePattern);
        args.push('--start-number', String(info.firstFrameNumber || 0));
      }

      setStatus(`Generating depth sequence (${model}${isVideo ? `, ${resolution}p` : ''})...`, '');

      python.runPythonScript(csInterface, 'video_depth_runner.py', args, {
        onStdout: (text) => {
          latestStdout += text;
          const progress = python.lastProgress(latestStdout);
          if (progress) {
            setStatus(`Depth frame ${progress.done}/${progress.total} (${model})...`, '');
          }
        },
        onError: (message) => finish(message, 'error'),
        onClose: (code) => {
          let frameCount = 0;
          try {
            frameCount = fs.readdirSync(outDir).filter((n) => n.startsWith('depth_')).length;
          } catch (err) {
            frameCount = 0;
          }
          if (code !== 0 || frameCount === 0) {
            finish(`Depth generation failed (see console). Exit code ${code}.`, 'error');
            return;
          }

          setStatus(`Importing ${frameCount}-frame depth sequence...`, '');
          // "#" is AE's sequence wildcard: ".../depth_#.png" imports every
          // depth_NNNN.png as ONE multi-frame footage item.
          const aeGlob = path.join(outDir, 'depth_#.png').replace(/\\/g, '/');
          const seqName = `${baseName}_DEPTH`;
          loadDepthModule(() => {
            csInterface.evalScript(
              `depthImportSequenceResult("${escapeScriptString(aeGlob)}", "${escapeScriptString(seqName)}")`,
              (rawResult) => {
                const result = parseHostResult(rawResult, 'Could not import the depth sequence');
                finish(result.message, result.ok ? 'success' : 'error');
              }
            );
          });
        }
      });
    }
  });
})();
