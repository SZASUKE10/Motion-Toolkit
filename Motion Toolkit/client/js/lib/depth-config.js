// Shared by js/modules/settings.js (the Depth Model dropdown in Settings)
// and js/modules/depth.js (the DEPTH button's background process). Keeping
// the default model + the dropdown's option list in one place means adding
// a new model is a one-line change here - plus a matching one-line entry in
// host/python/depth_runner.py's MODEL_REGISTRY - rather than a change
// scattered across multiple files.
(() => {
  const STORAGE_KEY = 'motionToolkitDepthSettings';
  const DEFAULT_MODEL = 'depth-anything-v2';
  // Default working resolution for generated depth maps: videos are decoded
  // downscaled to this HEIGHT before inference (see video_depth_runner.py's
  // --scale). Image sequences keep their native size. 1080 = 1080p.
  const DEFAULT_RESOLUTION = 1080;

  // `value` is sent as-is as the --model argument of depth_runner.py /
  // video_depth_runner.py, so it must match a key in that file's
  // MODEL_REGISTRY.
  const MODELS = [
    { value: 'depth-anything-v2', label: 'Depth Anything V2' },
    { value: 'depth-anything-v1', label: 'Depth Anything V1' },
    { value: 'midas', label: 'MiDaS' }
  ];

  // Keys resolved by host/python/rife_runner.py against the rife-models/
  // folder (see rife-models/README.md) - weights are not committed here to
  // keep the upload small. First entry is the default and the newest public
  // checkpoint in the NVIDIA v4.0 lineage that supports the alpha-preserving
  // pipeline described in rife_runner.py's docstring.
  const RIFE_MODELS = [
    { value: 'rife-nvidia-4.0', label: 'RIFE NVIDIA 4.0 (latest, alpha-safe)' },
    { value: 'rife-nvidia-4.0-lite', label: 'RIFE NVIDIA 4.0 Lite (faster)' }
  ];
  const DEFAULT_RIFE_MODEL = RIFE_MODELS[0].value;

  function getSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      const saved = raw ? JSON.parse(raw) : null;
      if (saved && typeof saved === 'object') return saved;
    } catch (err) {
      // fall through to defaults
    }
    return {};
  }

  function saveSettings(patch) {
    try {
      const next = Object.assign({}, getSettings(), patch);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.error('Could not save depth settings:', err);
    }
  }

  function getSelectedModel() {
    return getSettings().model || DEFAULT_MODEL;
  }

  function setSelectedModel(model) {
    saveSettings({ model });
  }

  function getResolution() {
    const raw = parseInt(getSettings().resolution, 10);
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_RESOLUTION;
  }

  function setResolution(resolution) {
    saveSettings({ resolution });
  }

  function getRifeModel() {
    return getSettings().rifeModel || DEFAULT_RIFE_MODEL;
  }

  function setRifeModel(model) {
    saveSettings({ rifeModel: model });
  }

  window.MotionToolkitDepthConfig = {
    STORAGE_KEY,
    DEFAULT_MODEL,
    DEFAULT_RESOLUTION,
    DEFAULT_RIFE_MODEL,
    MODELS,
    RIFE_MODELS,
    // Adjust if your Python isn't on PATH under this name - a dedicated
    // venv/conda env is common for ML work, e.g.
    // 'C:/venvs/depth/Scripts/python.exe' or '/Users/you/venvs/depth/bin/python3'.
    PYTHON_EXECUTABLE: process.platform === 'win32' ? 'python' : 'python3',
    getSelectedModel,
    setSelectedModel,
    getResolution,
    setResolution,
    getRifeModel,
    setRifeModel
  };
})();
