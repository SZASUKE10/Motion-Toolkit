(() => {
  document.addEventListener('DOMContentLoaded', () => {
    const navItems = document.querySelectorAll('.nav-item');
    const indicator = document.querySelector('.nav-indicator');

    function updateIndicator(element) {
      if (!element || !indicator) return;
      const width = element.offsetWidth;
      const leftPosition = element.offsetLeft;
      indicator.style.width = `${width}px`;
      indicator.style.transform = `translateX(${leftPosition - 6}px)`;
    } // Closing brace added

    // Initialize position on active tab
    const activeItem = document.querySelector('.nav-item.active');
    if (activeItem) {
      updateIndicator(activeItem);
    }

    // Handle indicator sliding on click
    navItems.forEach(item => {
      item.addEventListener('click', (e) => {
        e.preventDefault();
        navItems.forEach(nav => nav.classList.remove('active'));
        item.classList.add('active');
        updateIndicator(item);
      });
    });
  });
})();