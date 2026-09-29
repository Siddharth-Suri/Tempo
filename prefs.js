// Display preferences, applied as data attributes on <html>. Loaded synchronously in
// <head> so they take effect before first paint. Extension pages share one origin,
// so a change made in the popup reaches an open insights tab too.
const PREFS = { theme: 'grey', icons: 'on', layout: 'full' };
const root = document.documentElement;

for (const [key, fallback] of Object.entries(PREFS)) {
  root.dataset[key] = localStorage.getItem(key) ?? fallback;
}

addEventListener('storage', ({ key, newValue }) => {
  if (key in PREFS) root.dataset[key] = newValue ?? PREFS[key];
});
