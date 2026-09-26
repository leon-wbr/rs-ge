/** The runtime description of a SOAP service, generated from its WSDL by `scripts/generate.ts`. */

export type Scalar = 'string' | 'int' | 'long' | 'decimal' | 'double' | 'boolean' | 'dateTime' | 'base64Binary';

/** A scalar, `#TypeName` for a complex type, or `any` for untyped XML (usually a .NET DataSet). */
export type FieldType = Scalar | `#${string}` | 'any';

export interface Field {
  name: string;
  type: FieldType;
  /** Repeats (maxOccurs="unbounded"). */
  list?: true;
}

export interface Operation {
  /** The SOAPAction header value. */
  action: string;
  input: readonly Field[];
  output: readonly Field[];
}

export interface ServiceSchema {
  service: string;
  endpoint: string;
  namespace: string;
  /** Complex types by name. `ArrayOfX` wrappers are listed in `arrays` instead. */
  types: Readonly<Record<string, readonly Field[]>>;
  /** `ArrayOfX` wrapper types, mapped to their single repeated item. */
  arrays: Readonly<Record<string, Field>>;
  operations: Readonly<Record<string, Operation>>;
}
