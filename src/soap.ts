import { RsGeShapeError, RsGeTransportError } from './errors.ts';
import { normalizeDecimal } from './money.ts';
import type { Field, FieldType, ServiceSchema } from './schema.ts';
import { child, children, escapeXml, isNil, parseXml, type XmlElement } from './xml.ts';

/**
 * Pre-built XML for an untyped (`s:any`) input, inserted without escaping.
 * Only for operations like `save_waybill` whose payload the WSDL leaves open.
 */
export class RawXml {
  readonly xml: string;

  constructor(xml: string) {
    this.xml = xml;
  }
}

export interface Exchange {
  service: string;
  operation: string;
  /** Request XML with passwords replaced by `***`. */
  request: string;
  /** Response XML with passwords replaced by `***`, when one arrived. */
  response?: string;
  status?: number;
  durationMs: number;
}

export interface TransportOptions {
  fetch?: typeof fetch;
  /** Per attempt. Default 30 s. */
  timeoutMs?: number;
  /** Extra attempts for idempotent reads on network errors, timeouts and 5xx. Default 2. */
  retries?: number;
  /** Override a service's endpoint, e.g. for a proxy or a test server. */
  endpoints?: Partial<Record<string, string>>;
  /** Sees every exchange, already redacted. For logging and recording fixtures. */
  onExchange?: (exchange: Exchange) => void;
}

const PASSWORD_ELEMENT = /<((?:[\w-]+:)?(?:sp|[\w-]*password))(\s[^>]*)?>[\s\S]*?<\/\1>/gi;

/** Replace the content of every password-like element (`sp`, `password`, `inPassword`, `user_password`…) with `***`. */
export function redact(xml: string): string {
  return xml.replace(PASSWORD_ELEMENT, (_match, name: string, attrs = '') => `<${name}${attrs}>***</${name}>`);
}

function encodeValue(field: Field, value: unknown): string {
  if (value instanceof RawXml) return value.xml;
  if (field.type === 'boolean') return value ? 'true' : 'false';
  return escapeXml(String(value));
}

export function buildEnvelope(schema: ServiceSchema, operation: string, input: Record<string, unknown>): string {
  const op = schema.operations[operation];
  if (!op) throw new Error(`Unknown ${schema.service} operation ${operation}`);
  const unknown = Object.keys(input).filter((key) => !op.input.some((f) => f.name === key));
  if (unknown.length) throw new Error(`${operation} has no input ${unknown.join(', ')}`);
  // Elements go in WSDL order; ASMX's serializer ignores out-of-order elements silently.
  const body = op.input
    .flatMap((field) => {
      const value = input[field.name];
      if (value === undefined || value === null) return [];
      const values = field.list && Array.isArray(value) ? value : [value];
      return values.map((v) => `<${field.name}>${encodeValue(field, v)}</${field.name}>`);
    })
    .join('');
  return (
    '<?xml version="1.0" encoding="utf-8"?>' +
    '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">' +
    `<soap:Body><${operation} xmlns="${escapeXml(schema.namespace)}">${body}</${operation}></soap:Body>` +
    '</soap:Envelope>'
  );
}

class ShapeMismatch extends Error {}

function decodeValue(el: XmlElement, type: FieldType, schema: ServiceSchema): unknown {
  if (isNil(el)) return null;
  const text = el.text.trim();
  switch (type) {
    case 'string':
    case 'base64Binary':
      return el.text;
    case 'dateTime':
      return text === '' ? null : text;
    case 'int':
    case 'long': {
      if (text === '') return null;
      if (!/^-?\d+$/.test(text)) throw new ShapeMismatch(`<${el.name}> is not an integer: ${text}`);
      return Number(text);
    }
    case 'decimal':
    case 'double':
      try {
        return normalizeDecimal(text);
      } catch (error) {
        throw new ShapeMismatch(`<${el.name}>: ${(error as Error).message}`);
      }
    case 'boolean':
      if (text === '') return null;
      if (text !== 'true' && text !== 'false') throw new ShapeMismatch(`<${el.name}> is not a boolean: ${text}`);
      return text === 'true';
    case 'any':
      return el;
    default: {
      const name = type.slice(1);
      const item = schema.arrays[name];
      if (item) return children(el, item.name).map((c) => decodeValue(c, item.type, schema));
      const fields = schema.types[name];
      if (!fields) throw new ShapeMismatch(`Unknown type ${name}`);
      return decodeFields(el, fields, schema);
    }
  }
}

export function decodeFields(el: XmlElement, fields: readonly Field[], schema: ServiceSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.list) {
      out[field.name] = children(el, field.name).map((c) => decodeValue(c, field.type, schema));
    } else {
      const c = child(el, field.name);
      out[field.name] = c ? decodeValue(c, field.type, schema) : null;
    }
  }
  return out;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface InvokeOptions extends TransportOptions {
  /** Safe to retry: reads only. Writes are never retried. */
  idempotent?: boolean;
}

/** Send one SOAP 1.1 request and decode the response by the operation's WSDL output. */
export async function invoke(
  schema: ServiceSchema,
  operation: string,
  input: Record<string, unknown>,
  options: InvokeOptions = {},
): Promise<Record<string, unknown>> {
  const op = schema.operations[operation];
  if (!op) throw new Error(`Unknown ${schema.service} operation ${operation}`);
  const context = { service: schema.service, operation };
  const envelope = buildEnvelope(schema, operation, input);
  const endpoint = options.endpoints?.[schema.service] ?? schema.endpoint;
  const doFetch = options.fetch ?? globalThis.fetch;
  const attempts = options.idempotent ? 1 + (options.retries ?? 2) : 1;

  let lastError: RsGeTransportError | undefined;
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(250 * 2 ** (attempt - 1));
    const started = Date.now();
    let status: number | undefined;
    let text: string | undefined;
    try {
      const response = await doFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/xml; charset=utf-8', SOAPAction: `"${op.action}"` },
        body: envelope,
        signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
      });
      status = response.status;
      text = new TextDecoder('utf-8').decode(await response.arrayBuffer());
    } catch (error) {
      lastError = new RsGeTransportError(`${operation}: request failed (${(error as Error).name})`, context, { cause: error });
      continue;
    } finally {
      options.onExchange?.({
        ...context,
        request: redact(envelope),
        ...(text !== undefined && { response: redact(text) }),
        ...(status !== undefined && { status }),
        durationMs: Date.now() - started,
      });
    }
    if (status === undefined || text === undefined) continue;

    let root: XmlElement | undefined;
    try {
      root = parseXml(text);
    } catch {
      root = undefined;
    }
    const body = root && child(root, 'Body');
    const fault = body && child(body, 'Fault');
    if (fault) {
      const reason = child(fault, 'faultstring')?.text.trim() ?? 'SOAP fault';
      throw new RsGeTransportError(`${operation}: ${redact(reason)}`, { ...context, status });
    }
    if (status >= 500 || !body) {
      lastError = new RsGeTransportError(`${operation}: HTTP ${status}`, { ...context, status });
      if (status >= 500) continue;
      throw lastError;
    }
    if (status >= 400) throw new RsGeTransportError(`${operation}: HTTP ${status}`, { ...context, status });

    const result = child(body, `${operation}Response`);
    if (!result) throw new RsGeShapeError(`${operation}: no ${operation}Response element`, { ...context, xml: redact(text) });
    try {
      return decodeFields(result, op.output, schema);
    } catch (error) {
      if (error instanceof ShapeMismatch) throw new RsGeShapeError(`${operation}: ${error.message}`, { ...context, xml: redact(text) });
      throw error;
    }
  }
  throw lastError!;
}
