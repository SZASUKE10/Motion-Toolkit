(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const browser = document.querySelector('[data-custom-preset-browser]');
    if (!browser) return;

    const list = browser.querySelector('[data-custom-preset-list]');
    const count = browser.querySelector('[data-custom-preset-count]');
    const detail = browser.querySelector('[data-custom-preset-detail]');
    const csInterface = new CSInterface();
    const escapeScriptString = window.MotionToolkitUtil.escapeForEvalScript;
    let loaded = false;
    let presets = [];

    function applyPreset(path) {
      csInterface.evalScript(`applyFfxPreset("${escapeScriptString(path)}")`);
    }

    // NOTE: this builds a file:// URL for Windows-style paths only (splitting
    // on '/' and leaving the first segment, the drive letter, unencoded). It
    // has not been adjusted for macOS-style absolute paths (which start with
    // '/' and would pick up an extra leading slash here) since this build
    // targets Windows only for now.
    function toFileUrl(path) {
      if (!path) return '';
      return `file:///${path.replace(/\\/g, '/').split('/').map((part, index) => index === 0 ? part : encodeURIComponent(part)).join('/')}`;
    }

    function showDetails(preset) {
      detail.replaceChildren();
      const close = document.createElement('button');
      const title = document.createElement('h2');
      const copy = document.createElement('p');
      close.type = 'button';
      close.className = 'custom-preset-detail-close';
      close.textContent = 'CLOSE';
      close.addEventListener('click', () => { detail.hidden = true; });
      title.textContent = preset.name;
      copy.textContent = preset.description || 'No description yet. Add a same-name .txt file beside the .ffx preset.';
      detail.append(close, title, copy);
      detail.hidden = false;
    }

    function createCard(preset) {
      const card = document.createElement('article');
      const image = document.createElement('div');
      const content = document.createElement('div');
      const title = document.createElement('h2');
      const description = document.createElement('p');
      const actions = document.createElement('div');
      const readMore = document.createElement('button');
      const apply = document.createElement('button');

      card.className = 'custom-preset-card';
      image.className = 'custom-preset-image';
      if (preset.imagePath) {
        image.style.backgroundImage = `url("${toFileUrl(preset.imagePath)}")`;
        image.classList.add('has-image');
      }
      content.className = 'custom-preset-content';
      title.textContent = preset.name;
      description.textContent = preset.description || 'Custom FFX preset';
      actions.className = 'custom-preset-actions';
      readMore.type = 'button';
      readMore.textContent = 'READ MORE';
      readMore.addEventListener('click', () => showDetails(preset));
      apply.type = 'button';
      apply.textContent = 'APPLY';
      apply.addEventListener('click', () => applyPreset(preset.path));
      actions.append(readMore, apply);
      content.append(title, description, actions);
      card.append(image, content);
      return card;
    }

    function render() {
      list.replaceChildren();
      if (presets.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'preset-empty';
        empty.textContent = 'Add .ffx files to preset/custom';
        list.appendChild(empty);
      } else {
        presets.forEach((preset) => list.appendChild(createCard(preset)));
      }
      count.textContent = `${String(presets.length).padStart(2, '0')} PRESETS`;
    }

    function load() {
      if (loaded) return;
      loaded = true;
      const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
      const modulePath = `${extensionPath}/host/modules/preset-browser.jsx`.replace(/\\/g, '/');
      const presetPath = `${extensionPath}/preset/custom`.replace(/\\/g, '/');
      csInterface.evalScript(`$.evalFile("${escapeScriptString(modulePath)}")`, () => {
        csInterface.evalScript(`listCustomPresets("${escapeScriptString(presetPath)}")`, (result) => {
          presets = (result || '').split('\n').filter(Boolean).map((record) => {
            const parts = record.split('\t');
            return { name: (parts[0] || '').replace(/\.ffx$/i, ''), path: parts[1] || '', imagePath: parts[2] || '', description: parts.slice(3).join('\t') || '' };
          });
          render();
        });
      });
    }

    window.addEventListener('motion-toolkit-tab-change', (event) => {
      if (event.detail && event.detail.tab === 'Misc') load();
    });
  });
})();
