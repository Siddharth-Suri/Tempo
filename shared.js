// Data helpers shared by the service worker and the extension pages.

export const IDLE_OPTIONS = [2, 3, 4, 5];
export const DEFAULT_IDLE_MINUTES = 3;
export const RETENTION_DAYS = 30; // matches the month view

// The worker flushes every minute, so a longer open span means the machine slept
// and no flush could run. Never credit more than this in one go.
export const MAX_SPAN_MS = 2 * 60_000;

const pad = (n) => String(n).padStart(2, '0');

export function dayKey(time = Date.now()) {
  const d = new Date(time);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Keys for the last `count` days, oldest first, ending today.
export function pastDayKeys(count) {
  const d = new Date();
  d.setHours(12, 0, 0, 0); // midday keeps DST shifts from skipping a date
  const keys = [];
  for (let i = 0; i < count; i++) {
    keys.unshift(dayKey(d));
    d.setDate(d.getDate() - 1);
  }
  return keys;
}

// Yields [dayKey, ms] slices of a time span, cut at local midnight.
export function* splitByDay(start, end) {
  while (start < end) {
    const midnight = new Date(start);
    midnight.setHours(24, 0, 0, 0);
    const stop = Math.min(end, midnight.getTime());
    yield [dayKey(start), stop - start];
    start = stop;
  }
}

export async function readDays(keys) {
  const [{ icons = {}, ...days }, { session }] = await Promise.all([
    chrome.storage.local.get([...keys, 'icons']),
    chrome.storage.session.get('session'),
  ]);
  return { days, icons, session };
}

// `days` plus the not-yet-flushed time of the running session. Only the touched
// day objects are copied; the rest are shared with the input.
export function withLive(days, session) {
  if (!session) return days;
  const out = { ...days };
  const end = Math.min(Date.now(), session.since + MAX_SPAN_MS);
  for (const [key, ms] of splitByDay(session.since, end)) {
    const day = (out[key] = { ...out[key] });
    day[session.domain] = (day[session.domain] ?? 0) + ms;
  }
  return out;
}

// Days covered by each view, including today.
export const PERIODS = { week: 7, month: 30 };

export const total = (day = {}) => Object.values(day).reduce((a, b) => a + b, 0);

// Today's figures plus the daily average over the `keys` (today last) that have data.
// Today counts too, so an average exists from the very first day of tracking.
export function summarize(days, keys) {
  const today = days[keys.at(-1)] ?? {};
  const trackedKeys = keys.filter((key) => total(days[key]) > 0);
  const trackedTotal = trackedKeys.reduce((sum, key) => sum + total(days[key]), 0);
  return {
    today,
    todayTotal: total(today),
    trackedKeys,
    avgTotal: trackedKeys.length ? trackedTotal / trackedKeys.length : 0,
  };
}
