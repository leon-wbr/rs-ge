import { describe, expect, it } from 'vitest';
import { normalizeDecimal, toTetri } from '../src/money.ts';
import { assertCalendarDate, formatRsDate, parseRsDateTime, formatPeriod, periodRange } from '../src/dates.ts';

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

  it.each([
    ['-1234.50', -123450],
    ['-12.345', -1235],
    ['-12.344', -1234],
    ['-1.995', -200],
    ['-0.004', 0],
    ['-0', 0],
    ['-.5', -50],
  ])('negative %s → %i', (input, expected) => {
    expect(Object.is(toTetri(input), expected)).toBe(true);
  });

  it.each([
    ['1.999', 200],
    ['12.3449999', 1234],
    ['12.345000', 1235],
    ['0.0049999', 0],
    ['1.23456789', 123],
    ['2.5e-3', 0],
    ['5e-3', 1],
    ['-5e-3', -1],
  ])('rounds more than two decimals: %s → %i', (input, expected) => {
    expect(toTetri(input)).toBe(expected);
  });

  it('accepts surrounding whitespace and bare points', () => {
    expect(toTetri(' 1.5 ')).toBe(150);
    expect(toTetri('.5')).toBe(50);
    expect(toTetri('5.')).toBe(500);
  });

  it('rejects empty and whitespace-only amounts', () => {
    expect(() => toTetri('')).toThrow('Empty amount');
    expect(() => toTetri('   ')).toThrow('Empty amount');
  });

  it('rejects a lone sign or point', () => {
    expect(() => toTetri('-')).toThrow();
    expect(() => toTetri('.')).toThrow();
    expect(() => toTetri('-.')).toThrow();
  });

  it('stays within safe integers', () => {
    expect(toTetri('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(toTetri('-90071992547409.91')).toBe(-Number.MAX_SAFE_INTEGER);
    expect(() => toTetri('90071992547409.92')).toThrow('out of range');
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

  it('rejects empty text and near-misses of the format', () => {
    for (const bad of ['', ' 2026-05-31', '2026-5-31', '2026-05-31T00:00:00', '20260531']) {
      expect(() => formatRsDate(bad)).toThrow(RangeError);
    }
  });
});

describe('assertCalendarDate', () => {
  it('accepts leap days only in leap years', () => {
    expect(() => assertCalendarDate('2024-02-29')).not.toThrow();
    expect(() => assertCalendarDate('2000-02-29')).not.toThrow();
    expect(() => assertCalendarDate('2023-02-29')).toThrow(RangeError);
    expect(() => assertCalendarDate('1900-02-29')).toThrow(RangeError);
  });

  it('accepts month and year boundaries, rejects the day after', () => {
    for (const ok of ['2026-01-01', '2026-01-31', '2026-04-30', '2026-12-31']) {
      expect(() => assertCalendarDate(ok)).not.toThrow();
    }
    for (const bad of ['2026-00-01', '2026-01-00', '2026-01-32', '2026-04-31', '2026-13-01', '2026-12-32']) {
      expect(() => assertCalendarDate(bad)).toThrow(RangeError);
    }
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
    expect(parseRsDateTime('   ')).toBeNull();
  });

  it('crosses day, month, leap-day and year boundaries when shifting to UTC+4', () => {
    expect(parseRsDateTime('2026-01-31T19:59:59Z')).toEqual({ date: '2026-01-31', iso: '2026-01-31T23:59:59+04:00' });
    expect(parseRsDateTime('2026-01-31T20:00:00Z')).toEqual({ date: '2026-02-01', iso: '2026-02-01T00:00:00+04:00' });
    expect(parseRsDateTime('2024-02-28T20:00:00Z')).toEqual({ date: '2024-02-29', iso: '2024-02-29T00:00:00+04:00' });
    expect(parseRsDateTime('2023-02-28T20:00:00Z')).toEqual({ date: '2023-03-01', iso: '2023-03-01T00:00:00+04:00' });
    expect(parseRsDateTime('2026-12-31T20:00:00Z')).toEqual({ date: '2027-01-01', iso: '2027-01-01T00:00:00+04:00' });
  });

  it('shifts back across a boundary for offsets east of Tbilisi', () => {
    expect(parseRsDateTime('2024-03-01T00:30:00+05:00')).toEqual({ date: '2024-02-29', iso: '2024-02-29T23:30:00+04:00' });
    expect(parseRsDateTime('2027-01-01T00:00:00+05:00')).toEqual({ date: '2026-12-31', iso: '2026-12-31T23:00:00+04:00' });
  });

  it('keeps an offset-less leap day as is', () => {
    expect(parseRsDateTime('2024-02-29T00:00:00')).toEqual({ date: '2024-02-29', iso: '2024-02-29T00:00:00+04:00' });
  });

  it('rejects text that is not a dateTime', () => {
    expect(() => parseRsDateTime('2026-05-31')).toThrow(RangeError);
    expect(() => parseRsDateTime('31.05.2026 12:00')).toThrow(RangeError);
  });
});

describe('formatPeriod', () => {
  it('formats a year and month', () => {
    expect(formatPeriod({ year: 2026, month: 4 })).toBe('2026-04');
    expect(() => formatPeriod({ year: 2026, month: 13 })).toThrow();
  });

  it('rejects month 0 and non-integers', () => {
    expect(() => formatPeriod({ year: 2026, month: 0 })).toThrow(RangeError);
    expect(() => formatPeriod({ year: 2026, month: 1.5 })).toThrow(RangeError);
  });
});

describe('periodRange', () => {
  it.each([
    [2024, 2, '2024-02-01', '2024-02-29'],
    [2023, 2, '2023-02-01', '2023-02-28'],
    [2000, 2, '2000-02-01', '2000-02-29'],
    [2100, 2, '2100-02-01', '2100-02-28'],
    [2026, 1, '2026-01-01', '2026-01-31'],
    [2026, 4, '2026-04-01', '2026-04-30'],
    [2026, 12, '2026-12-01', '2026-12-31'],
  ])('%i-%i → %s … %s', (year, month, from, to) => {
    expect(periodRange({ year, month })).toEqual({ from, to });
  });

  it('rejects an invalid month', () => {
    expect(() => periodRange({ year: 2026, month: 13 })).toThrow(RangeError);
  });
});
