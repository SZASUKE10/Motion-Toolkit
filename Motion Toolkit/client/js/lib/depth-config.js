// Shared by js/modules/settings.js (the Depth Model dropdown in Settings)
// and js/modules/depth.js (the DEPTH button's background process). Keeping
// the default model + the dropdown's option list in one place means adding
// a new model is a one-line change here - plus a matching one-line entry in
// host/python/depth_runner.py's MODEL_REGISTRY - rather than a change
// scattered across multiple files.
(() => {
  const STORAGE_KEY = 'motionToolkitDepthSettings';
  const DEFAULT_MODEL = 'depth-anything-v2';

  // `value` is sent as-is as depth_runner.py's --model argument, so it must
  // match a key in that file's MODEL_REGISTRY.
  const MODELS = [
    { value: 'depth-anything-v2', label: 'Depth Anything V2' },
    { value: 'depth-anything-v1', label: 'Depth Anything V1' },
    { value: 'midas', label: 'MiDaS' }
  ];

  function getSelectedModel() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && saved.model) return saved.model;
    } catch (err) {
      // fall through to default
    }
    return DEFAULT_MODEL;
  }

  function setSelectedModel(model) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ model }));
    } catch (err) {
      console.error('Could not save depth model setting:', err);
    }
  }

  window.MotionToolkitDepthConfig = {
    STORAGE_KEY,
    DEFAULT_MODEL,
    MODELS,
    // Adjust if your Python isn't on PATH under this name - a dedicated
    // venv/conda env is common for ML work, e.g.
    // 'C:/venvs/depth/Scripts/python.exe' or '/Users/you/venvs/depth/bin/python3'.
    PYTHON_EXECUTABLE: process.platform === 'win32' ? 'python' : 'python3',
    getSelectedModel,
    setSelectedModel
  };
})();
