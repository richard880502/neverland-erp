export const THEME_STORAGE_KEY = "neverland-theme";

// Runs before the page is painted, so a saved dark preference never flashes light.
export const THEME_INITIALIZATION_SCRIPT = `
  (() => {
    let preference = 'system';
    try {
      const saved = localStorage.getItem('${THEME_STORAGE_KEY}');
      if (saved === 'light' || saved === 'dark') preference = saved;
    } catch {}
    const dark = preference === 'dark' || (preference === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.dataset.themePreference = preference;
  })();
`;
