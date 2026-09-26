/**
 * Amounts stay decimal strings from the wire to the caller, so no float
 * rounding can reach a tax figure. `toTetri` converts to integer minor units.
 */

/** A decimal number as a string, e.g. `'1234.50'`. */
export type Decimal = string;

const NUMBER = /^([+-]?)(\d*)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/;

/** Canonical decimal text for an XML decimal or double, expanding exponents. Empty text is null. */
export function normalizeDecimal(text: string): Decimal | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const match = NUMBER.exec(trimmed);
  if (!match || (match[2] === '' && (match[3] ?? '') === '')) throw new Error(`Not a decimal number: ${JSON.stringify(text)}`);
  const [, sign = '', int = '', frac = '', exp] = match;
  if (exp === undefined) return `${sign === '-' ? '-' : ''}${int || '0'}${frac ? `.${frac}` : ''}`;

  const digits = int + frac;
  const point = int.length + Number(exp);
  let whole: string;
  let fraction: string;
  if (point <= 0) {
    whole = '0';
    fraction = '0'.repeat(-point) + digits;
  } else if (point >= digits.length) {
    whole = digits + '0'.repeat(point - digits.length);
    fraction = '';
  } else {
    whole = digits.slice(0, point);
    fraction = digits.slice(point);
  }
  whole = whole.replace(/^0+(?=\d)/, '');
  fraction = fraction.replace(/0+$/, '');
  return `${sign === '-' ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

/** Integer tetri (1/100 GEL), rounding half away from zero at the third decimal. */
export function toTetri(amount: Decimal): number {
  const normalized = normalizeDecimal(amount);
  if (normalized === null) throw new Error('Empty amount');
  const negative = normalized.startsWith('-');
  const [int = '0', frac = ''] = normalized.replace('-', '').split('.');
  const padded = frac.padEnd(3, '0');
  let tetri = BigInt(int) * 100n + BigInt(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) tetri += 1n;
  const value = Number(negative ? -tetri : tetri);
  if (!Number.isSafeInteger(value)) throw new Error(`Amount out of range: ${amount}`);
  return value === 0 ? 0 : value;
}
