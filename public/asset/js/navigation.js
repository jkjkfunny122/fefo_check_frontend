document.querySelectorAll('[data-mobile-menu-toggle]').forEach(toggle => {
    const menu = document.getElementById(toggle.getAttribute('aria-controls'));
    const icon = toggle.querySelector('[data-mobile-menu-icon]');
    if (!menu || !icon) {
        console.error('Mobile navigation toggle is missing its menu or icon.');
        return;
    }

    function setMenuOpen(isOpen) {
        toggle.setAttribute('aria-expanded', String(isOpen));
        toggle.setAttribute('aria-label', isOpen ? 'ปิดเมนูนำทาง' : 'เปิดเมนูนำทาง');
        menu.classList.toggle('hidden', !isOpen);
        menu.classList.toggle('flex', isOpen);
        icon.textContent = isOpen ? '×' : '☰';
    }

    toggle.addEventListener('click', () => {
        setMenuOpen(toggle.getAttribute('aria-expanded') !== 'true');
    });

    menu.addEventListener('click', event => {
        if (event.target.closest('a')) setMenuOpen(false);
    });

    document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && toggle.getAttribute('aria-expanded') === 'true') {
            setMenuOpen(false);
            toggle.focus();
        }
    });
});
