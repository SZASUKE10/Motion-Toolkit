(() => {
  const csInterface = new CSInterface();
  const escapeScriptString = window.MotionToolkitUtil.escapeForEvalScript;
  let hostModuleLoaded = false;

  function loadHostModule(onReady) {
    if (hostModuleLoaded) {
      onReady();
      return;
    }

    const extensionPath = csInterface.getSystemPath(SystemPath.EXTENSION);
    const scriptPath = `${extensionPath}/host/modules/graph-engine.jsx`.replace(/\\/g, '/');
    csInterface.evalScript(`$.evalFile("${escapeScriptString(scriptPath)}")`, (result) => {
      if (result && result.indexOf('EvalScript error') !== -1) {
        window.dispatchEvent(new CustomEvent('motion-graph-apply-result', {
          detail: { ok: false, message: `Could not load graph engine: ${result}` }
        }));
        return;
      }
      hostModuleLoaded = true;
      onReady();
    });
  }

  window.MotionGraphApplication = {
    apply(payload) {
      loadHostModule(() => {
        const serializedPayload = escapeScriptString(JSON.stringify(payload));
        csInterface.evalScript(`applyMotionGraph("${serializedPayload}")`, (result) => {
          let detail;
          if (result && result.indexOf('EvalScript error') !== -1) {
            // A thrown exception - the host never even got to return its own
            // {ok, message} object.
            detail = { ok: false, message: `Could not apply graph: ${result}` };
          } else {
            try {
              const parsed = JSON.parse(result);
              detail = {
                ok: Boolean(parsed.ok),
                message: parsed.message || (parsed.ok ? 'Graph applied.' : 'Could not apply graph.')
              };
            } catch (parseError) {
              // Old-style plain-string result (or something unexpected) -
              // treat it as informational rather than guessing it succeeded.
              detail = { ok: false, message: result || 'Could not apply graph.' };
            }
          }
          window.dispatchEvent(new CustomEvent('motion-graph-apply-result', { detail }));
        });
      });
    }
  };

  document.addEventListener('DOMContentLoaded', () => {
    loadHostModule(() => {
      function refreshContext() {
        csInterface.evalScript('getMotionGraphContext()', (result) => {
          let context = { empty: true, status: 'NO AE CONTEXT', detail: 'Select an animated property.' };
          try {
            context = JSON.parse(result);
          } catch (error) {
            context.detail = 'Could not read After Effects context.';
          }
          window.dispatchEvent(new CustomEvent('motion-graph-context', { detail: context }));
        });
      }

      let graphTabActive = Boolean(document.querySelector('#Graph.active'));
      window.addEventListener('motion-toolkit-tab-change', (event) => {
        graphTabActive = Boolean(event.detail && event.detail.tab === 'Graph');
        if (graphTabActive) refreshContext();
      });

      if (graphTabActive) refreshContext();
      window.setInterval(() => {
        if (graphTabActive && document.visibilityState !== 'hidden') refreshContext();
      }, 1000);
    });
  });
})();
