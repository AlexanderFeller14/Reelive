// Normalisiert Eingaben zu E.164. Schweizer Konvention als Default:
// 07x… und 0041… werden zu +41…; alles mit + bleibt wie eingegeben.
export function normalizePhone(input: string): string | null {
  let digits = input.replace(/[\s\-()./]/g, '');
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (/^0[1-9]\d+$/.test(digits)) digits = `+41${digits.slice(1)}`;
  return /^\+[1-9]\d{6,14}$/.test(digits) ? digits : null;
}
