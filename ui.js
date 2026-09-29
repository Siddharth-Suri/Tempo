// DOM helpers shared by the popup and the insights page.
import { PERIODS, total } from './shared.js';

export function formatDuration(ms) {
  if (ms <= 0) return '0m';
  const minutes = Math.floor(ms / 60_000);
  if (!minutes) return '<1m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (!h) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function change(value, avg) {
  if (!avg) return { text: value ? 'New' : '—', cls: '' };
  const pct = Math.round(((value - avg) / avg) * 100);
  if (!pct) return { text: '0%', cls: '' };
  return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)}%`, cls: pct > 0 ? 'more' : 'less' };
}

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Uses the icon Chrome showed on the site's tab, falling back to Chrome's local
// favicon cache if it is missing or fails to load. Lazy loading means hidden icons
// (the "Remove site icons" setting) are never fetched at all.
export function favicon(domain, icons) {
  const img = new Image(16, 16);
  img.className = 'favicon';
  img.alt = '';
  img.loading = 'lazy';
  const cached = chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(`https://${domain}/`)}&size=32`);
  img.src = icons[domain] ?? cached;
  img.onerror = () => {
    img.onerror = null;
    img.src = cached;
  };
  return img;
}

// Segmented control with a sliding thumb, driven by the --i / --n custom properties.
export function segmented(root, options, value, onChange) {
  root.style.setProperty('--n', options.length);
  const buttons = options.map((option) => {
    const button = el('button', '', option.label);
    button.addEventListener('click', () => {
      if (option.value === value) return;
      select(option.value);
      onChange(option.value);
    });
    return button;
  });
  root.replaceChildren(...buttons);

  function select(next) {
    value = next;
    const index = options.findIndex((o) => o.value === next);
    root.style.setProperty('--i', index);
    buttons.forEach((b, i) => b.classList.toggle('on', i === index));
  }
  select(value);
}

function toDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

// Daily-total bar chart with an average line. Columns are rebuilt only when the
// day range changes; otherwise bars update in place so they glide to new values.
export function barChart(root) {
  const avgLine = el('div', 'avg-line');
  let cols = [];
  let dates = [];

  function build(keys, animate) {
    const weekly = keys.length <= PERIODS.week;
    dates = keys.map((key) =>
      toDate(key).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
    );
    cols = keys.map((key, i) => {
      const isToday = i === keys.length - 1;
      const col = el('div', isToday ? 'col today' : 'col');
      col.style.setProperty('--d', i);
      col.append(el('div', 'fill'));
      // Longer ranges label every fifth day, counted back from today so today is always labelled.
      if (weekly || (keys.length - 1 - i) % 5 === 0) {
        const date = toDate(key);
        const label = isToday
          ? 'Today'
          : weekly
            ? date.toLocaleDateString(undefined, { weekday: 'short' })
            : String(date.getDate());
        col.append(el('span', 'tick', label));
      }
      return col;
    });
    root.dataset.first = keys[0];
    root.classList.toggle('enter', animate);
    root.replaceChildren(...cols, avgLine);
  }

  return function update(keys, days, avgTotal, animate = false) {
    if (animate || root.dataset.first !== keys[0] || cols.length !== keys.length) build(keys, animate);
    const totals = keys.map((key) => total(days[key]));
    const max = Math.max(...totals, avgTotal, 1);
    cols.forEach((col, i) => {
      col.style.setProperty('--h', totals[i] / max);
      col.dataset.tip = `${dates[i]} · ${formatDuration(totals[i])}`;
    });
    avgLine.style.setProperty('--h', avgTotal / max);
    avgLine.style.opacity = avgTotal ? 1 : 0;
  };
}
