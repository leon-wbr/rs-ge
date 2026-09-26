import { describe, expect, it } from 'vitest';
import { normalizeDecimal, toTetri } from '../src/money.ts';
import { formatRsDate, parseRsDateTime, formatPeriod } from '../src/dates.ts';

describe('normalizeDecimal', () => {
  it.each([
    ['1234.50', '1234.50'],
    ['-0.1', '-0.1'],
    ['+7', '7'],
    ['1E-05', '0.00001'],
    ['1.25e3', '1250'],
    ['12345678901234567.89', '12345678901234567.89'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeDecimal(input)).toBe(expected);
  });

  it('returns null for empty text, and throws on garbage', () => {
    expect(normalizeDecimal('')).toBeNull();
    expect(() => normalizeDecimal('12,5')).toThrow();
    expect(() => normalizeDecimal('NaN')).toThrow();
  });
});

describe('toTetri', () => {
  it.each([
    ['1234.50', 123450],
    ['0.005', 1],
    ['0.004', 0],
    ['-0.005', -1],
    ['19', 1900],
    ['0.1', 10],
  ])('%s → %i', (input, expected) => {
    expect(toTetri(input)).toBe(expected);
  });
});

describe('formatRsDate', () => {
  it('formats a calendar date as Tbilisi local midnight, or the end of the day', () => {
    expect(formatRsDate('2026-05-31')).toBe('2026-05-31T00:00:00');
    expect(formatRsDate('2026-05-31', { endOfDay: true })).toBe('2026-05-31T23:59:59');
  });

  it('rejects anything but YYYY-MM-DD and impossible dates', () => {
    expect(() => formatRsDate('31.05.2026')).toThrow();
    expect(() => formatRsDate('2026-02-30')).toThrow();
  });
});

describe('parseRsDateTime', () => {
  it('reads an offset-less value as Tbilisi time', () => {
    expect(parseRsDateTime('2026-05-31T12:30:00')).toEqual({ date: '2026-05-31', iso: '2026-05-31T12:30:00+04:00' });
  });

  it('converts values that carry an offset into Tbilisi time', () => {
    expect(parseRsDateTime('2026-05-31T22:30:00Z')).toEqual({ date: '2026-06-01', iso: '2026-06-01T02:30:00+04:00' });
    expect(parseRsDateTime('2026-05-31T12:30:00.5+04:00')).toEqual({ date: '2026-05-31', iso: '2026-05-31T12:30:00+04:00' });
  });

  it('maps .NET’s "no date" and empty text to null', () => {
    expect(parseRsDateTime('0001-01-01T00:00:00')).toBeNull();
    expect(parseRsDateTime('')).toBeNull();
  });
});

describe('formatPeriod', () => {
  it('formats a year and month', () => {
    expect(formatPeriod({ year: 2026, month: 4 })).toBe('2026-04');
    expect(() => formatPeriod({ year: 2026, month: 13 })).toThrow();
  });
});
