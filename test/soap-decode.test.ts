import { describe, expect, it } from 'vitest';
import type { ServiceSchema } from '../src/schema.ts';
import { decodeFields } from '../src/soap.ts';
import { parseXml } from '../src/xml.ts';

const schema: ServiceSchema = { service: 'test', endpoint: '', namespace: '', types: {}, arrays: {}, operations: {} };
const decode = (type: 'double' | 'decimal', text: string) =>
  decodeFields(parseXml(`<r><V>${text}</V></r>`), [{ name: 'V', type }], schema).V;

describe('decodeValue special floating-point values', () => {
  it.each([
    ['INF', Infinity],
    ['-INF', -Infinity],
    ['NaN', NaN],
  ])('decodes double %s to the matching number', (text, expected) => {
    expect(decode('double', text)).toBe(expected);
  });

  it('still decodes ordinary doubles to decimal strings', () => {
    expect(decode('double', '1E2')).toBe('100');
  });

  it.each(['INF', '-INF', 'NaN'])('rejects %s for decimal, which xs:decimal does not allow', (text) => {
    expect(() => decode('decimal', text)).toThrow();
  });
});
