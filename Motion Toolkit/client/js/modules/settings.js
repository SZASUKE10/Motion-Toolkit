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

    // RIFE (playback) settings: model dropdown + max output height, both
    // stored in the same depth-config.js object the PLAY button reads.
    const rifeSelect = document.querySelector('[data-rife-model-select]');
    const rifeResInput = document.querySelector('[data-rife-resolution]');
    const rifeSaveBtn = document.querySelector('[data-rife-save]');
    const rifeStatus = document.querySelector('[data-rife-status]');

    if (rifeSelect && rifeResInput && rifeSaveBtn) {
      config.RIFE_MODELS.forEach((model) => {
        const option = document.createElement('option');
        option.value = model.value;
        option.textContent = model.label;
        rifeSelect.appendChild(option);
      });

      function showRifeStatus(text) {
        if (rifeStatus) rifeStatus.textContent = text;
      }

      rifeSelect.value = config.getRifeModel();
      rifeResInput.value = String(config.getResolution());

      rifeSaveBtn.addEventListener('click', () => {
        config.setRifeModel(rifeSelect.value);
        const parsed = parseInt(rifeResInput.value, 10);
        if (Number.isFinite(parsed) && parsed >= 240 && parsed <= 2160) {
          // Round down to an even px height - RIFE pads/crops internally but
          // even dimensions keep alpha re-attachment and AE import clean.
          config.setResolution(parsed - (parsed % 2));
        }
        rifeResInput.value = String(config.getResolution());
        showRifeStatus(`Saved: ${config.getRifeModel()} @ ${config.getResolution()}p`);
      });

      showRifeStatus(`Active: ${config.getRifeModel()} @ ${config.getResolution()}p (NVIDIA CUDA only)`);
    }
  });
})();
