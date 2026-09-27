/**
 * rs.ge's .NET services exchange `dateTime` values without a zone, meaning
 * Tbilisi local time (UTC+4 all year, no daylight saving since 2005). Callers
 * pass calendar dates as `YYYY-MM-DD` strings, never `Date` objects, so a UTC
 * `Date` can't shift a period boundary by a day.
 */

const TBILISI_OFFSET_MS = 4 * 60 * 60 * 1000;

/** A calendar date, `YYYY-MM-DD`. */
export type CalendarDate = string;

export interface TaxPeriod {
  year: number;
  month: number;
}

export interface RsDateTime {
  /** The Tbilisi calendar date. */
  date: CalendarDate;
  /** ISO 8601 with the +04:00 offset, to the second. */
  iso: string;
}

export function assertCalendarDate(value: string): void {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const valid =
    match && new Date(Date.UTC(+match[1]!, +match[2]! - 1, +match[3]!)).toISOString().slice(0, 10) === value;
  if (!valid) throw new RangeError(`Expected a YYYY-MM-DD date, got ${JSON.stringify(value)}`);
}

/** The wire form of a calendar date: Tbilisi midnight, or the day's last second for inclusive range ends. */
export function formatRsDate(date: CalendarDate, options: { endOfDay?: boolean } = {}): string {
  assertCalendarDate(date);
  return `${date}T${options.endOfDay ? '23:59:59' : '00:00:00'}`;
}

export function parseRsDateTime(text: string): RsDateTime | null {
  const value = text.trim();
  if (value === '' || value.startsWith('0001-01-01')) return null;
  const match = /^(\d{4}-\d{2}-\d{2})T(([01]\d|2[0-3]):[0-5]\d:[0-5]\d)(?:\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(value);
  if (!match) throw new RangeError(`Unrecognised dateTime ${JSON.stringify(text)}`);
  const [, date, time, , zone] = match;
  // Without this, an impossible date passes through as is, or rolls over once an offset makes Date parse it.
  assertCalendarDate(date!);
  if (!zone) return { date: date!, iso: `${date}T${time}+04:00` };
  const local = new Date(new Date(`${date}T${time}${zone}`).getTime() + TBILISI_OFFSET_MS).toISOString();
  return { date: local.slice(0, 10), iso: `${local.slice(0, 19)}+04:00` };
}

export function formatPeriod({ year, month }: TaxPeriod): string {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`Invalid tax period ${year}-${month}`);
  }
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** First and last calendar day of a tax period. */
export function periodRange({ year, month }: TaxPeriod): { from: CalendarDate; to: CalendarDate } {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const prefix = formatPeriod({ year, month });
  return { from: `${prefix}-01`, to: `${prefix}-${String(last).padStart(2, '0')}` };
}
