/* Settings tab: the version label and the Depth Model dropdown.
   The dropdown just reads/writes window.MotionToolkitDepthConfig (see
   js/lib/depth-config.js) - js/modules/depth.js reads the same object when
   the DEPTH button runs, so this file only owns the Settings-tab UI for
   choosing the model, not the model list itself. */
(() => {
  // Bump this on release; this constant is the one place that needs to
  // change next time. Kept in sync with CSXS/manifest.xml's version fields.
  const MOTION_TOOLKIT_VERSION = '4.1.5';

  document.addEventListener('DOMContentLoaded', () => {
    const versionLabel = document.querySelector('[data-settings-version]');
    if (versionLabel) {
      versionLabel.textContent = `Motion Toolkit v${MOTION_TOOLKIT_VERSION}`;
    }

    const select = document.querySelector('[data-depth-model-select]');
    if (!select) return;

    const config = window.MotionToolkitDepthConfig;

    config.MODELS.forEach((model) => {
      const option = document.createElement('option');
      option.value = model.value;
      option.textContent = model.label;
      select.appendChild(option);
    });

    select.value = config.getSelectedModel();

    select.addEventListener('change', () => {
      config.setSelectedModel(select.value);
    });
  });
})();
