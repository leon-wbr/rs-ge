export { createRsGe, type RsGeClient, type RsGeOptions, type ServiceUser } from './client.ts';
export { RsGeAuthError, RsGeError, RsGeServiceError, RsGeShapeError, RsGeTransportError } from './errors.ts';
export { RawXml, redact, type Exchange, type TransportOptions } from './soap.ts';
export { normalizeDecimal, toTetri, type Decimal } from './money.ts';
export { formatPeriod, parseRsDateTime, periodRange, type CalendarDate, type RsDateTime, type TaxPeriod } from './dates.ts';
export type { XmlElement } from './xml.ts';
export type * from './generated/taxpayer.ts';
export type { WaybillOperations } from './generated/waybill.ts';
export type { InvoicesOperations } from './generated/invoices.ts';
