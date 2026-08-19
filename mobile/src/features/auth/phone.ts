// Normalizes input to E.164. Swiss convention as the default: 07x… and
// 0041… become +41…; anything with a + stays as entered.
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s\-()./]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (/^0[1-9]\d+$/.test(digits)) digits = `+41${digits.slice(1)}`;
  return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null;
}
