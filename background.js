import {
  DEFAULT_IDLE_MINUTES,
  MAX_SPAN_MS,
  RETENTION_DAYS,
  dayKey,
  pastDayKeys,
  splitByDay,
} from './shared.js';

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
// Non-day keys the extension owns; prune removes anything else.
const KEYS = new Set(['idleMinutes', 'icons']);
const MAX_ICON_URL = 20_000; // skips oversized inline data: icons

let idleSeconds = DEFAULT_IDLE_MINUTES * 60;

function applyIdle(minutes) {
  idleSeconds = minutes * 60;
  chrome.idle.setDetectionInterval(idleSeconds);
}

const ready = chrome.storage.local
  .get('idleMinutes')
  .then(({ idleMinutes = DEFAULT_IDLE_MINUTES }) => applyIdle(idleMinutes));

// Storage writes are read-modify-write, so every state change runs one at a time.
let queue = Promise.resolve();
function enqueue(task) {
  queue = queue.then(() => task()).catch(console.error);
}

async function commit({ domain, since }, end) {
  // A negative span (idle fired after a flush) gives back time already credited.
  const parts = end >= since ? [...splitByDay(since, end)] : [[dayKey(since), end - since]];
  if (!parts.length) return;
  const days = await chrome.storage.local.get(parts.map(([key]) => key));
  for (const [key, ms] of parts) {
    const day = (days[key] ??= {});
    day[domain] = Math.max(0, (day[domain] ?? 0) + ms);
  }
  await chrome.storage.local.set(days);
}

async function activePage() {
  if ((await chrome.idle.queryState(idleSeconds)) !== 'active') return null;
  // Two small lookups instead of populating every tab object in the window.
  const [win, [tab]] = await Promise.all([
    chrome.windows.getLastFocused().catch(() => null),
    chrome.tabs.query({ active: true, lastFocusedWindow: true }),
  ]);
  if (!win?.focused || !tab?.url) return null;
  const { protocol, hostname } = new URL(tab.url);
  if (protocol !== 'https:' && protocol !== 'http:') return null;
  const icon = tab.favIconUrl;
  return {
    domain: hostname.replace(/^www\./, ''),
    icon: /^(https|data):/.test(icon) && icon.length <= MAX_ICON_URL ? icon : null,
  };
}

// Keeps the icon URL Chrome shows on the tab strip for each site.
async function rememberIcon({ domain, icon }) {
  const { icons = {} } = await chrome.storage.local.get('icons');
  if (icons[domain] === icon) return;
  icons[domain] = icon;
  await chrome.storage.local.set({ icons });
}

// Closes the running session and opens a new one for whatever is in front now.
async function sync(wentIdle = false) {
  await ready;
  // Chrome reports idle only after the threshold passes, so that stretch is dropped.
  const end = Date.now() - (wentIdle ? idleSeconds * 1000 : 0);
  const { session } = await chrome.storage.session.get('session');
  if (session) await commit(session, Math.min(end, session.since + MAX_SPAN_MS));

  const page = await activePage();
  if (!page) return chrome.storage.session.remove('session');
  await chrome.storage.session.set({ session: { ...page, since: Date.now() } });
  // The session carries the last icon seen, so storage is only touched when it changes.
  if (page.icon && (page.domain !== session?.domain || page.icon !== session.icon)) {
    await rememberIcon(page);
  }
}

async function prune() {
  const keep = pastDayKeys(RETENTION_DAYS);
  const stale = (await chrome.storage.local.getKeys()).filter((k) =>
    DAY_KEY.test(k) ? !keep.includes(k) : !KEYS.has(k),
  );
  if (stale.length) await chrome.storage.local.remove(stale);

  // Drop icons for sites that no longer appear in any kept day.
  const [{ icons = {}, ...days }, { session }] = await Promise.all([
    chrome.storage.local.get([...keep, 'icons']),
    chrome.storage.session.get('session'),
  ]);
  const seen = new Set(Object.values(days).flatMap(Object.keys));
  if (session) seen.add(session.domain);
  const kept = Object.entries(icons).filter(([domain]) => seen.has(domain));
  if (kept.length < Object.keys(icons).length) {
    await chrome.storage.local.set({ icons: Object.fromEntries(kept) });
  }
}

async function ensureAlarms() {
  if (!(await chrome.alarms.get('tick'))) chrome.alarms.create('tick', { periodInMinutes: 1 });
  if (!(await chrome.alarms.get('prune'))) {
    chrome.alarms.create('prune', { periodInMinutes: 360, when: Date.now() });
  }
}

ensureAlarms();

chrome.runtime.onInstalled.addListener(() => enqueue(sync));
chrome.runtime.onStartup.addListener(() => enqueue(sync));
chrome.tabs.onActivated.addListener(() => enqueue(sync));
chrome.tabs.onUpdated.addListener((_id, change, tab) => {
  if (tab.active && (change.url || change.favIconUrl)) enqueue(sync);
});
chrome.windows.onFocusChanged.addListener(() => enqueue(sync));
chrome.idle.onStateChanged.addListener((state) => enqueue(() => sync(state === 'idle')));
chrome.alarms.onAlarm.addListener(({ name }) => enqueue(name === 'prune' ? prune : sync));
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.idleMinutes) {
    applyIdle(changes.idleMinutes.newValue);
    enqueue(sync);
  }
});
