/* Wires the footer "DEPTH" button to host/modules/depth.jsx and
   host/python/depth_runner.py.

   Flow for one click:
     1. evalScript depthGetJobInfo()      -> selected layer's source path,
                                              project folder, DEPTH folder.
     2. fs.mkdirSync the DEPTH folder, spawn depth_runner.py against it.
     3. On the child process's "close" event, evalScript depthImportResult()
        to bring the finished file back into the AE project.

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

  // Shared between depthGetJobInfo() and depthImportResult() results below -
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

    const { spawn } = require('child_process');
    const fs = require('fs');
    const path = require('path');

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
          runDepthJob(info);
        });
      });
    });

    function runDepthJob(info) {
      let outputPath;
      try {
        fs.mkdirSync(info.depthDir, { recursive: true });
        const baseName = path.parse(info.sourcePath).name;
        outputPath = path.join(info.depthDir, `${baseName}_depth.png`);
      } catch (err) {
        finish(`Could not prepare the DEPTH folder: ${err.message}`, 'error');
        return;
      }

      const config = window.MotionToolkitDepthConfig;
      const model = config.getSelectedModel();
      const scriptPath = path.join(csInterface.getSystemPath(SystemPath.EXTENSION), 'host', 'python', 'depth_runner.py');

      setStatus(`Generating depth map (${model})...`, '');

      const child = spawn(config.PYTHON_EXECUTABLE, [
        scriptPath,
        '--input', info.sourcePath,
        '--output', outputPath,
        '--model', model
      ]);

      let stderrTail = '';
      child.stderr.on('data', (chunk) => {
        stderrTail = (stderrTail + chunk.toString()).slice(-2000);
        console.error('depth_runner.py:', chunk.toString());
      });
      child.stdout.on('data', (chunk) => console.log('depth_runner.py:', chunk.toString()));

      child.on('error', (err) => {
        // e.g. ENOENT - config.PYTHON_EXECUTABLE isn't on PATH.
        finish(`Could not start Python (${config.PYTHON_EXECUTABLE}): ${err.message}`, 'error');
      });

      child.on('close', (code) => {
        if (code !== 0 || !fs.existsSync(outputPath)) {
          const lastLine = stderrTail.trim().split('\n').pop() || `exit code ${code}`;
          finish(`Depth generation failed: ${lastLine}`, 'error');
          return;
        }

        setStatus('Importing depth map...', '');
        loadDepthModule(() => {
          csInterface.evalScript(`depthImportResult("${escapeScriptString(outputPath)}")`, (rawResult) => {
            const result = parseHostResult(rawResult, 'Could not import the depth map');
            finish(result.message, result.ok ? 'success' : 'error');
          });
        });
      });
    }
  });
})();
