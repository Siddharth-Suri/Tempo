import { DEFAULT_IDLE_MINUTES, IDLE_OPTIONS, PERIODS, pastDayKeys, readDays, summarize, withLive } from './shared.js';
import { barChart, change, el, favicon, formatDuration, segmented } from './ui.js';

const TOP_SITES = 3;

const $ = (id) => document.getElementById(id);
const list = $('sites');
const rows = new Map();
const chart = barChart($('chart'));
let state = { days: {}, icons: {}, session: null };
let firstRender = true;

function createRow(domain, icons) {
  const li = el('li', 'site');
  li.style.animationDelay = `${120 + rows.size * 40}ms`;
  const time = el('span', 'time num');
  const bar = el('div', 'bar');
  const track = el('div', 'track');
  track.append(bar);
  li.append(favicon(domain, icons), el('span', 'domain', domain), time, track);
  const row = { li, time, bar };
  rows.set(domain, row);
  return row;
}

function renderSites(today, icons) {
  const top = Object.entries(today)
    .filter(([, ms]) => ms >= 1000)
    .sort((a, b) => b[1] - a[1])
    .slice(0, TOP_SITES);
  const max = top[0]?.[1] ?? 1;
  const visible = new Set();

  top.forEach(([domain, ms], i) => {
    const row = rows.get(domain) ?? createRow(domain, icons);
    visible.add(domain);
    row.time.textContent = formatDuration(ms);
    row.bar.style.transform = `scaleX(${ms / max})`;
    if (list.children[i] !== row.li) list.insertBefore(row.li, list.children[i] ?? null);
  });
  for (const [domain, row] of rows) {
    if (!visible.has(domain)) {
      row.li.remove();
      rows.delete(domain);
    }
  }
  $('empty').hidden = top.length > 0;
}

function render() {
  const keys = pastDayKeys(PERIODS.week);
  const days = withLive(state.days, state.session);
  const { today, todayTotal, avgTotal } = summarize(days, keys);

  $('total').textContent = formatDuration(todayTotal);
  const delta = change(todayTotal, avgTotal);
  $('delta').hidden = !avgTotal;
  $('delta').textContent = `${delta.text} vs daily average`;
  $('delta').className = `chip num ${delta.cls}`;

  chart(keys, days, avgTotal, firstRender);
  renderSites(today, state.icons);
  firstRender = false;
}

async function load() {
  state = await readDays(pastDayKeys(PERIODS.week));
  render();
}

function showSettings(open) {
  document.body.classList.toggle('show-settings', open);
  $('home').inert = open;
  $('settings').inert = !open;
}

$('open-settings').addEventListener('click', () => showSettings(true));
$('close-settings').addEventListener('click', () => showSettings(false));
// Support page on the developer's portfolio. Until it is set, the button does nothing.
const SUPPORT_URL = '';

function openTab(url) {
  chrome.tabs.create({ url });
  window.close();
}

$('insights').addEventListener('click', () => openTab('dashboard.html'));
$('support').addEventListener('click', () => SUPPORT_URL && openTab(SUPPORT_URL));

chrome.storage.local.get('idleMinutes').then(({ idleMinutes = DEFAULT_IDLE_MINUTES }) => {
  segmented(
    $('idle'),
    IDLE_OPTIONS.map((m) => ({ value: m, label: `${m} min` })),
    idleMinutes,
    (m) => chrome.storage.local.set({ idleMinutes: m }),
  );
});

// Display preferences: see prefs.js for defaults.
const prefs = document.documentElement.dataset;
function setPref(key, value) {
  localStorage.setItem(key, value);
  prefs[key] = value;
}

segmented(
  $('theme'),
  [
    { value: 'grey', label: 'Grey' },
    { value: 'beige', label: 'Beige' },
  ],
  prefs.theme,
  (theme) => setPref('theme', theme),
);

$('no-icons').checked = prefs.icons === 'off';
$('no-icons').addEventListener('change', (e) => setPref('icons', e.target.checked ? 'off' : 'on'));

$('compact').checked = prefs.layout === 'compact';
$('compact').addEventListener('change', (e) => setPref('layout', e.target.checked ? 'compact' : 'full'));

// Only day totals and the running session affect this view.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'session' || !('idleMinutes' in changes)) load();
});
// Times display to the minute, so a light refresh keeps the running site current.
setInterval(() => state.session && render(), 5000);
load();
