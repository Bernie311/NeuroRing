/* Theme selection runs before styles and renderers to avoid a colored first frame. */
(() => {
  'use strict';
  const key = 'neuroring.colorTheme';
  const valid = value => value === 'mono' || value === 'original';
  const url = new URL(location.href);
  let saved;
  try { saved = localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
  const requested = url.searchParams.get('theme');
  const mode = valid(requested) ? requested : valid(saved) ? saved : 'mono';
  document.documentElement.dataset.theme = mode;
  const hexCache = new Map(), rgbCache = new Map();
  const gray = (r, g, b) => Math.round((Math.max(r, g, b) + Math.min(r, g, b)) / 2);
  function color(value) {
    if (mode !== 'mono' || typeof value !== 'string') return value;
    if (value[0] === '#') {
      if (hexCache.has(value)) return hexCache.get(value);
      let hex = value.slice(1);
      if (hex.length === 3 || hex.length === 4) hex = [...hex].map(c => c + c).join('');
      if (!/^(?:[\da-f]{6}|[\da-f]{8})$/i.test(hex)) return value;
      const level = gray(...[0, 2, 4].map(i => parseInt(hex.slice(i, i + 2), 16)));
      const result = '#' + level.toString(16).padStart(2, '0').repeat(3) + hex.slice(6);
      hexCache.set(value, result);
      return result;
    }
    const match = /^(rgba?)\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(.*)\)$/.exec(value);
    if (!match) return value;
    const triplet = match.slice(2, 5).join(',');
    if (!rgbCache.has(triplet)) rgbCache.set(triplet, gray(...match.slice(2, 5).map(Number)));
    const level = rgbCache.get(triplet);
    // Cache only RGB, not animated alpha values, so the cache remains bounded.
    return `${match[1]}(${level},${level},${level}${match[5]})`;
  }
  globalThis.NeuroTheme = Object.freeze({mode, color});
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('color-theme');
    if (!select) return;
    select.value = mode;
    select.addEventListener('change', () => {
      if (!valid(select.value) || select.value === mode) return;
      const next = new URL(location.href);
      try {
        localStorage.setItem(key, select.value);
        next.searchParams.delete('theme');
      } catch {
        next.searchParams.set('theme', select.value);
      }
      // Rebuild cached ring textures and instrument palettes consistently.
      location.replace(next.href);
    });
  });
})();
