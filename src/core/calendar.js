// Proleptic Gregorian calendar on an integer day count (day 0 = 1970-01-01).
// Works for ancient (negative/BCE years, astronomical numbering) and far-future dates.

export function daysFromCivil(y, m, d) {
  y -= m <= 2 ? 1 : 0;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (m + (m > 2 ? -3 : 9)) + 2) / 5) + d - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

export function civilFromDays(z) {
  z += 719468;
  const era = Math.floor(z / 146097);
  const doe = z - era * 146097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const d = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const m = mp + (mp < 10 ? 3 : -9);
  return { y: yoe + era * 400 + (m <= 2 ? 1 : 0), m, d };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDate(day) {
  const { y, m, d } = civilFromDays(day);
  const year = y <= 0 ? `${1 - y} BCE` : String(y);
  return `${d} ${MONTHS[m - 1]} ${year}`;
}

export function parseDate(s) {
  const m = /^(-?\d+)-(\d{1,2})-(\d{1,2})$/.exec(String(s).trim());
  if (!m) throw new Error(`Invalid date "${s}" (expected YYYY-MM-DD)`);
  return daysFromCivil(+m[1], +m[2], +m[3]);
}

export function dateString(day) {
  const { y, m, d } = civilFromDays(day);
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
