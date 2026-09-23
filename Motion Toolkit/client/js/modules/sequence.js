/* Wires the footer "SEQUENCE" button to host/modules/sequence.jsx. */
(() => {
  const csInterface = new CSInterface();
  let hostModuleLoaded = false;

  // Loads host/modules/sequence.jsx into the ExtendScript engine so that
  // sequenceSelectedLayers() becomes callable via evalScript(). Same pattern
  // as js/modules/anchor.js's loadAnchorModule() - see the comment there for
  // why the path has to be built here instead of via $.fileName on the
  // ExtendScript side.
  function loadSequenceModule(onReady) {
    if (hostModuleLoaded) {
      onReady();
      return;
    }
    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    const scriptPath = (extensionPath + '/host/modules/sequence.jsx').replace(/\\/g, '/');

    csInterface.evalScript(`$.evalFile("${scriptPath}")`, (result) => {
      if (result && result.indexOf('EvalScript error') !== -1) {
        console.error('Failed to load sequence.jsx:', result, scriptPath);
        return;
      }
      hostModuleLoaded = true;
      onReady();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    loadSequenceModule(() => {});

    const button = document.querySelector('[data-sequence-button]');
    const statusLabel = document.querySelector('[data-playback-status]');
    if (!button) return;

    function setStatus(text, state) {
      if (!statusLabel) return;
      statusLabel.textContent = text;
      statusLabel.dataset.state = state || '';
      statusLabel.hidden = false;
    }

    button.addEventListener('click', () => {
      button.disabled = true;
      setStatus('Sequencing...', '');

      loadSequenceModule(() => {
        csInterface.evalScript('sequenceSelectedLayers()', (result) => {
          button.disabled = false;

          if (result && result.indexOf('EvalScript error') !== -1) {
            console.error('sequenceSelectedLayers failed:', result);
            setStatus('Sequence failed - see console.', 'error');
            return;
          }
          try {
            const parsed = JSON.parse(result);
            setStatus(parsed.message || (parsed.ok ? 'Sequenced.' : 'Sequence failed.'), parsed.ok ? 'success' : 'error');
          } catch (err) {
            setStatus(result || 'Sequence failed.', 'error');
          }
        });
      });
    });
  });
})();
