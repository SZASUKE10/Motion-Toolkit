(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const csInterface = new CSInterface();

    document.querySelectorAll('[data-external-link]').forEach((trigger) => {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        const url = trigger.getAttribute('data-external-link');
        if (url) csInterface.openURLInDefaultBrowser(url);
      });
    });
  });
})();
