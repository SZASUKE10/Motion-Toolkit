// Shared by graph-bridge.js, preset-browser.js, and custom-preset-browser.js.
// Used to be copy-pasted independently in all three (as escapeScriptString in
// two of them, escapeExtendScriptString in the third) - one shared copy means
// a future fix only has to happen in one place.
(() => {
  function escapeForEvalScript(value) {
    return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  }

  window.MotionToolkitUtil = window.MotionToolkitUtil || {};
  window.MotionToolkitUtil.escapeForEvalScript = escapeForEvalScript;
})();
