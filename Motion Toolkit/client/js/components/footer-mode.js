(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const toggleButton = document.querySelector('[data-footer-mode-toggle]');
    const modeA = document.querySelector('[data-footer-mode-a]');
    const modeB = document.querySelector('[data-footer-mode-b]');
    if (!toggleButton || !modeA || !modeB) return;

    toggleButton.addEventListener('click', () => {
      const switchingToB = modeB.hidden;
      modeB.hidden = !switchingToB;
      modeA.hidden = switchingToB;
      toggleButton.setAttribute('aria-pressed', String(switchingToB));
    });
  });
})();
