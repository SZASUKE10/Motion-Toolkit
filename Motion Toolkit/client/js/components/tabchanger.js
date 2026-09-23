(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item');
    const panels = document.querySelectorAll('.tab-panel');
    const appShell = document.querySelector('.app-shell');

    function setActiveTab(targetTab) {
      if (appShell) appShell.classList.toggle('graph-active', targetTab === 'Graph');
      window.dispatchEvent(new CustomEvent('motion-toolkit-tab-change', {
        detail: { tab: targetTab }
      }));
    }

    const initialPanel = document.querySelector('.tab-panel.active');
    setActiveTab(initialPanel ? initialPanel.id : 'Graph');

    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        const targetTab = item.getAttribute('data-tab');

        panels.forEach(panel => {
          if (panel.id === targetTab) {
            panel.classList.add('active');
          } else {
            panel.classList.remove('active');
          }
        });
        setActiveTab(targetTab);
      });
    });
  });
})();