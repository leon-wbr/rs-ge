/**
 * Turns a recorded response into a fixture that is safe to commit: every
 * identifier (TIN, personal number, name, address) becomes a stable fake of
 * the same shape, and decimal amounts are scaled by a secret factor. Rates
 * (0 < |x| < 1) and integers such as years and codes stay as they are.
 *
 *   node scripts/anonymise.ts <in.raw.xml> <out.xml>
 *   RSGE_IDENTIFIERS='206322102,Name Surname' RSGE_SCALE=0.83
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const GEORGIAN_FAKE = 'ანბანი';

function fakeFor(identifier: string): string {
  const digest = createHash('sha256').update(identifier).digest();
  let i = 0;
  return [...identifier]
    .map((c) => {
      const byte = digest[i++ % digest.length]!;
      if (/\d/.test(c)) return String(byte % 10);
      if (/[a-z]/i.test(c)) return String.fromCharCode(97 + (byte % 26));
      if (/[ა-ჿ]/.test(c)) return GEORGIAN_FAKE[byte % GEORGIAN_FAKE.length]!;
      return c;
    })
    .join('');
}

function scale(amount: string, factor: number): string {
  const decimals = amount.split('.')[1]!.length;
  const value = Number(amount);
  if (Math.abs(value) < 1) return amount;
  return (value * factor).toFixed(decimals);
}

export function anonymiseXml(xml: string, options: { identifiers: string[]; factor: number }): string {
  let out = xml;
  // Longest first, so a full name is replaced before a part of it.
  for (const identifier of [...options.identifiers].filter(Boolean).sort((a, b) => b.length - a.length)) {
    out = out.split(identifier).join(fakeFor(identifier));
  }
  out = out.replace(/>(-?\d+\.\d+)</g, (_m, amount: string) => `>${scale(amount, options.factor)}<`);
  for (const identifier of options.identifiers) {
    if (identifier && out.includes(identifier)) throw new Error('An identifier survived anonymisation');
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [input, output] = process.argv.slice(2);
  const identifiers = (process.env.RSGE_IDENTIFIERS ?? '').split(',').map((s) => s.trim());
  const factor = Number(process.env.RSGE_SCALE);
  if (!input || !output || !identifiers.some(Boolean) || !(factor > 0)) {
    console.error('Usage: RSGE_IDENTIFIERS=… RSGE_SCALE=… node scripts/anonymise.ts <in> <out>');
    process.exit(2);
  }
  writeFileSync(output, anonymiseXml(readFileSync(input, 'utf8'), { identifiers, factor }));
}
