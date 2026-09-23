/* everything anchor point related is here */

(() => {
  const csInterface = new CSInterface();

  // Loads host/modules/anchor.jsx into the ExtendScript engine so that
  // setAnchorPoint(...) becomes callable via evalScript(). We can't rely on
  // $.fileName on the ExtendScript side to find this file (see
  // host/index.jsx), so we build the absolute path here instead, using the
  // extension's real install folder.
  function loadAnchorModule() {
    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    const scriptPath = (extensionPath + '/host/modules/anchor.jsx').replace(/\\/g, '/');

    csInterface.evalScript(`$.evalFile("${scriptPath}")`, (result) => {
      if (result && result.indexOf('EvalScript error') !== -1) {
        console.error('Failed to load anchor.jsx:', result, scriptPath);
      } else {
        console.log('anchor.jsx loaded:', result);
      }
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    // Load the ExtendScript module once, up front, before any anchor
    // button can be clicked.
    loadAnchorModule();

    document.body.addEventListener('click', (e) => {
      const btn = e.target.closest('.anchor-button');
      if (!btn) return;

      const position = btn.getAttribute('data-anchor');
      if (position) {
        csInterface.evalScript(`setAnchorPoint("${position}")`, (result) => {
          if (result && result.indexOf('EvalScript error') !== -1) {
            console.error('setAnchorPoint failed:', result);
          }
        });
      }
    });
  });
})();
