export function money(b) {
  const a = Math.abs(b);
  const s = a >= 1000 ? (a / 1000).toFixed(2) + 'T' : a >= 100 ? a.toFixed(0) + 'B' : a >= 1 ? a.toFixed(1) + 'B' : (a * 1000).toFixed(0) + 'M';
  return (b < 0 ? '−' : '') + s;
}
export function signedMoney(b) { return (b >= 0 ? '+' : '') + money(b); }
export function people(n) {
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return Math.round(n / 1e3) + 'k';
  return Math.round(n).toLocaleString();
}
export function pct(x, d = 0) { return (x * 100).toFixed(d) + '%'; }
export const GOV_NAMES = {
  republic: 'Presidential republic', federal_republic: 'Federal republic', parliamentary: 'Parliamentary republic',
  const_monarchy: 'Constitutional monarchy', abs_monarchy: 'Absolute monarchy', one_party: 'One-party state',
  military: 'Military government', theocracy: 'Theocratic republic',
};
