// Small CEP-panel-specific UI fixes (formerly "tester.js" - that name and the
// HTML comment above its <script> tag were left over from an early bridge
// test and no longer described what this file does).
(() => {
  // CEP panels run inside a Chromium view, so an unmodified Ctrl/Cmd+A can
  // trigger the browser's own "select all text on the page" instead of
  // behaving like a native panel - suppress it everywhere except inside the
  // actual search input, where select-all should still work normally.
  document.addEventListener("keydown", (event) => {
    if (!event.ctrlKey && !event.metaKey) return;
    if (event.key.toLowerCase() !== "a") return;
    if (event.target.closest(".preset-search-input")) return;

    event.preventDefault();
    window.getSelection().removeAllRanges();
  });

  // Buttons/links otherwise keep a visible focus ring after being clicked.
  // Blurring the panel window right after a click removes that lingering
  // highlight without affecting real form controls (inputs/selects/etc.,
  // which are excluded below).
  document.addEventListener("click", (event) => {
    if (event.target.closest("input, textarea, select")) return;
    if (!event.target.closest("button, a")) return;

    setTimeout(() => {
      window.blur();
    }, 0);
  });
})();
