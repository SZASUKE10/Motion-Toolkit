/* Shared helpers for spawning the Python runners under host/python/
   (depth_runner.py, video_depth_runner.py, rife_runner.py). Both
   js/modules/depth.js and js/modules/playback.js go through here so the
   spawn/error/exit plumbing only exists in one place. */
(() => {
  function runPythonScript(csInterface, scriptName, args, handlers) {
    const { spawn } = require('child_process');
    const path = require('path');
    const config = window.MotionToolkitDepthConfig;

    const scriptPath = path.join(csInterface.getSystemPath(SystemPath.EXTENSION), 'host', 'python', scriptName);
    const child = spawn(config.PYTHON_EXECUTABLE, [scriptPath].concat(args));

    let stderrTail = '';
    let stdoutTail = '';

    child.stderr.on('data', (chunk) => {
      stderrTail = (stderrTail + chunk.toString()).slice(-2000);
      console.error(`${scriptName}:`, chunk.toString());
    });

    child.stdout.on('data', (chunk) => {
      const text = chunk.toString();
      stdoutTail = (stdoutTail + text).slice(-4000);
      console.log(`${scriptName}:`, text);
      if (handlers && typeof handlers.onStdout === 'function') {
        handlers.onStdout(text);
      }
    });

    child.on('error', (err) => {
      // e.g. ENOENT - config.PYTHON_EXECUTABLE isn't on PATH.
      if (handlers && typeof handlers.onError === 'function') {
        handlers.onError(`Could not start Python (${config.PYTHON_EXECUTABLE}): ${err.message}`);
      }
    });

    child.on('close', (code) => {
      if (handlers && typeof handlers.onClose === 'function') {
        handlers.onClose(code, { stderrTail, stdoutTail });
      }
    });

    return child;
  }

  // Pulls the newest "PROGRESS done/total" line out of accumulated stdout so
  // callers can show a live frame counter while a runner works.
  function lastProgress(stdoutTail) {
    const matches = String(stdoutTail || '').match(/PROGRESS (\d+)\/(\S+)/g);
    if (!matches || !matches.length) return null;
    const last = matches[matches.length - 1].split(/\s+/)[1].split('/');
    return { done: parseInt(last[0], 10), total: last[1] };
  }

  window.MotionToolkitPython = {
    runPythonScript,
    lastProgress
  };
})();
