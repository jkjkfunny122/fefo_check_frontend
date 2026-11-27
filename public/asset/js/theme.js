(function initializeTheme() {
    const storageKey = 'fefo-theme';
    const root = document.documentElement;

    function readStoredTheme() {
        try {
            return window.localStorage.getItem(storageKey);
        } catch (error) {
            console.error('Unable to read the saved theme preference:', error);
            return null;
        }
    }

    function saveTheme(theme) {
        try {
            window.localStorage.setItem(storageKey, theme);
        } catch (error) {
            console.error('Unable to save the theme preference:', error);
        }
    }

    function applyTheme(theme) {
        const isDark = theme === 'dark';
        root.classList.toggle('dark', isDark);
        root.style.colorScheme = isDark ? 'dark' : 'light';

        const toggle = document.getElementById('theme-toggle');
        if (toggle) {
            toggle.querySelector('[data-theme-icon]').textContent = isDark ? '☀' : '☾';
            toggle.setAttribute('aria-label', isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด');
            toggle.setAttribute('aria-pressed', String(isDark));
        }
    }

    const storedTheme = readStoredTheme();
    const initialTheme = storedTheme === 'dark' || storedTheme === 'light'
        ? storedTheme
        : (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    applyTheme(initialTheme);

    document.addEventListener('DOMContentLoaded', () => {
        const toggle = document.getElementById('theme-toggle');
        if (!toggle) return;

        applyTheme(root.classList.contains('dark') ? 'dark' : 'light');
        toggle.addEventListener('click', () => {
            const nextTheme = root.classList.contains('dark') ? 'light' : 'dark';
            applyTheme(nextTheme);
            saveTheme(nextTheme);
        });
    });
})();
