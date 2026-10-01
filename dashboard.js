import { PERIODS, RETENTION_DAYS, pastDayKeys, readDays, summarize, withLive } from './shared.js';
import { barChart, change, el, favicon, formatDuration, segmented } from './ui.js';

const $ = (id) => document.getElementById(id);
const chart = barChart($('chart'));
let period = 'week';

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function renderCards({ today, todayTotal, avgTotal, trackedKeys }) {
  const top = Object.entries(today).sort((a, b) => b[1] - a[1])[0];
  $('today').textContent = formatDuration(todayTotal);
  $('today-sub').textContent = top
    ? `${plural(Object.keys(today).length, 'site')} · most on ${top[0]}`
    : 'Nothing tracked yet';

  $('avg-label').textContent = `Daily average · ${PERIODS[period]} days`;
  $('avg').textContent = trackedKeys.length ? formatDuration(avgTotal) : '—';
  $('avg-sub').textContent = trackedKeys.length
    ? `Across ${plural(trackedKeys.length, 'tracked day')}`
    : 'Nothing tracked yet';

  const delta = change(todayTotal, avgTotal);
  const diff = todayTotal - avgTotal;
  $('delta').textContent = delta.text;
  $('delta').className = `big num ${delta.cls}`;
  $('delta-sub').textContent = trackedKeys.length
    ? `${formatDuration(Math.abs(diff))} ${diff >= 0 ? 'more' : 'less'} than usual`
    : 'Nothing tracked yet';
}

function renderTable({ today, trackedKeys }, days, icons, animate) {
  const sites = new Map();
  const entry = (domain) => sites.get(domain) ?? sites.set(domain, { today: 0, sum: 0 }).get(domain);
  for (const [domain, ms] of Object.entries(today)) entry(domain).today = ms;
  for (const key of trackedKeys) for (const [domain, ms] of Object.entries(days[key])) entry(domain).sum += ms;

  const rows = [...sites]
    .map(([domain, s]) => ({ domain, today: s.today, avg: s.sum / trackedKeys.length }))
    .filter((r) => r.today >= 1000 || r.avg >= 1000)
    .sort((a, b) => Math.max(b.today, b.avg) - Math.max(a.today, a.avg));

  const tbody = $('sites');
  tbody.classList.toggle('enter', animate);
  tbody.replaceChildren(
    ...rows.map((r, i) => {
      const tr = el('tr');
      tr.style.setProperty('--d', Math.min(i, 12));
      const name = el('div', 'site');
      name.append(favicon(r.domain, icons), r.domain);
      const site = el('td');
      site.append(name);
      const delta = change(r.today, r.avg);
      const last = el('td');
      last.append(el('span', `chip ${delta.cls}`, delta.text));
      const cells = [r.today, r.avg].map((ms) => el('td', '', ms ? formatDuration(ms) : '—'));
      tr.append(site, ...cells, last);
      return tr;
    }),
  );
  $('empty').hidden = rows.length > 0;
}

async function render(animate = false) {
  const allKeys = pastDayKeys(RETENTION_DAYS);
  const { days: stored, icons, session } = await readDays(allKeys);
  const days = withLive(stored, session);
  const keys = allKeys.slice(-PERIODS[period]);
  const summary = summarize(days, keys);

  renderCards(summary);
  chart(keys, days, summary.avgTotal, animate);
  renderTable(summary, days, icons, animate);
}

segmented(
  $('period'),
  [
    { value: 'week', label: 'Week' },
    { value: 'month', label: 'Month' },
  ],
  period,
  (value) => {
    period = value;
    render(true);
  },
);

// The worker writes both storage areas each minute; coalesce into one refresh.
let refresh;
chrome.storage.onChanged.addListener(() => {
  clearTimeout(refresh);
  refresh = setTimeout(render, 300);
});

render(true);
