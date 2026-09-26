/** Base class of every error rs-ge throws. Messages never contain credentials. */
export class RsGeError extends Error {
  readonly service: string;
  readonly operation: string;

  constructor(message: string, context: { service: string; operation: string }, options?: ErrorOptions) {
    super(message, options);
    this.name = new.target.name;
    this.service = context.service;
    this.operation = context.operation;
  }
}

/** rs.ge rejected the service user name or password. Retrying with the same credentials won't help. */
export class RsGeAuthError extends RsGeError {}

/** rs.ge answered with an error status or code. */
export class RsGeServiceError extends RsGeError {
  readonly code: number | undefined;
  /** The description as rs.ge sent it, usually in Georgian. */
  readonly description: string | undefined;

  constructor(
    message: string,
    context: { service: string; operation: string; code?: number | undefined; description?: string | undefined },
    options?: ErrorOptions,
  ) {
    super(message, context, options);
    this.code = context.code;
    this.description = context.description;
  }
}

/** The request didn't produce a usable answer: network failure, timeout, HTTP error or SOAP fault. */
export class RsGeTransportError extends RsGeError {
  readonly status: number | undefined;

  constructor(message: string, context: { service: string; operation: string; status?: number | undefined }, options?: ErrorOptions) {
    super(message, context, options);
    this.status = context.status;
  }
}

/** The response doesn't have the shape this version of rs-ge expects. `xml` is the redacted response. */
export class RsGeShapeError extends RsGeError {
  readonly xml: string;

  constructor(message: string, context: { service: string; operation: string; xml: string }) {
    super(message, context);
    this.xml = context.xml;
  }
}
