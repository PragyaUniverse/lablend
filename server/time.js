// Time helpers. All booking times are stored as epoch milliseconds and interpreted
// in the institution's timezone, so the server and every browser agree on opening hours.
// A demo clock offset lets judges "fast-forward" to check-in, overdue and no-show states.

export const TZ = process.env.INSTITUTION_TZ || 'Asia/Kolkata';
export const MIN = 60_000;
export const H = 60 * MIN;
export const DAY = 24 * H;

let offsetMs = 0;
export const setClockOffset = (ms) => { offsetMs = ms; };
export const clockOffset = () => offsetMs;
export const now = () => Date.now() + offsetMs;

const dtf = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23', weekday: 'short',
});
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zoned(ms) {
  const p = Object.fromEntries(dtf.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return {
    y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second,
    dow: DOW.indexOf(p.weekday), date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`,
  };
}

function tzOffset(ms) {
  const z = zoned(ms);
  return Date.UTC(z.y, z.m - 1, z.d, z.hh, z.mm, z.ss) - Math.floor(ms / 1000) * 1000;
}

// Convert a wall-clock date ("2026-10-30") and time ("14:30") in the institution TZ to epoch ms.
export function wallToMs(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '') || !/^\d{2}:\d{2}$/.test(time || '')) return NaN;
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const off = tzOffset(guess);
  let res = guess - off;
  const off2 = tzOffset(res);
  if (off2 !== off) res = guess - off2;
  return res;
}

export const minutesOf = (hhmm) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + m; };
export const dateAdd = (date, days) => zoned(wallToMs(date, '12:00') + days * DAY).date;
export const fmtH = (h) => `${Math.round(h * 10) / 10} h`;

const human = new Intl.DateTimeFormat('en-IN', {
  timeZone: TZ, weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
});
export const fmt = (ms) => human.format(new Date(ms));
