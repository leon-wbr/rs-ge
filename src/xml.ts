/**
 * A small XML reader for SOAP responses: elements, attributes, text, CDATA
 * and the predefined and numeric entities. DOCTYPEs are rejected, so there
 * is no entity expansion to exploit.
 */

export interface XmlElement {
  /** Local name, without namespace prefix. */
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  text: string;
}

const ENTITIES: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-fA-F]+|#\d+|\w+);/g, (match, ref: string) => {
    if (ref.startsWith('#x')) return String.fromCodePoint(Number.parseInt(ref.slice(2), 16));
    if (ref.startsWith('#')) return String.fromCodePoint(Number.parseInt(ref.slice(1), 10));
    const entity = ENTITIES[ref];
    if (entity === undefined) throw new Error(`Unknown XML entity ${match}`);
    return entity;
  });
}

const localName = (qualified: string) => qualified.slice(qualified.indexOf(':') + 1);

const ATTR = /([^\s=]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

export function parseXml(xml: string): XmlElement {
  const stack: XmlElement[] = [];
  const openNames: string[] = [];
  let root: XmlElement | undefined;
  let i = 0;

  const appendText = (value: string) => {
    const top = stack.at(-1);
    if (top) top.text += value;
    else if (value.trim()) throw new Error('Text outside the root element');
  };

  while (i < xml.length) {
    const lt = xml.indexOf('<', i);
    if (lt === -1) {
      appendText(decodeEntities(xml.slice(i)));
      break;
    }
    if (lt > i) appendText(decodeEntities(xml.slice(i, lt)));

    if (xml.startsWith('<?', lt)) {
      i = indexAfter(xml, '?>', lt);
    } else if (xml.startsWith('<!--', lt)) {
      i = indexAfter(xml, '-->', lt);
    } else if (xml.startsWith('<![CDATA[', lt)) {
      const end = indexAfter(xml, ']]>', lt);
      appendText(xml.slice(lt + 9, end - 3));
      i = end;
    } else if (xml.startsWith('<!', lt)) {
      throw new Error('DOCTYPE and other declarations are not accepted');
    } else if (xml.startsWith('</', lt)) {
      const end = indexAfter(xml, '>', lt);
      const name = xml.slice(lt + 2, end - 1).trim();
      const open = openNames.pop();
      if (open !== name) throw new Error(`Mismatched closing tag </${name}>, expected </${open}>`);
      stack.pop();
      i = end;
    } else {
      const end = tagEnd(xml, lt);
      const selfClosing = xml[end - 2] === '/';
      const inner = xml.slice(lt + 1, selfClosing ? end - 2 : end - 1);
      const nameMatch = /^[^\s/>]+/.exec(inner);
      if (!nameMatch) throw new Error(`Malformed tag at offset ${lt}`);
      const attrs: Record<string, string> = {};
      for (const m of inner.slice(nameMatch[0].length).matchAll(ATTR)) {
        attrs[localName(m[1]!)] = decodeEntities(m[3] ?? m[4] ?? '');
      }
      const element: XmlElement = { name: localName(nameMatch[0]), attrs, children: [], text: '' };
      const parent = stack.at(-1);
      if (parent) parent.children.push(element);
      else if (root) throw new Error('More than one root element');
      else root = element;
      if (!selfClosing) {
        stack.push(element);
        openNames.push(nameMatch[0]);
      }
      i = end;
    }
  }

  if (stack.length > 0) throw new Error(`Unclosed element <${openNames.at(-1)}>`);
  if (!root) throw new Error('No root element');
  return root;
}

function indexAfter(xml: string, token: string, from: number): number {
  const at = xml.indexOf(token, from);
  if (at === -1) throw new Error(`Unterminated markup at offset ${from}`);
  return at + token.length;
}

/** The index just past the `>` closing a start tag, skipping `>` inside quoted attribute values. */
function tagEnd(xml: string, from: number): number {
  let quote: string | undefined;
  for (let j = from + 1; j < xml.length; j++) {
    const c = xml[j];
    if (quote) {
      if (c === quote) quote = undefined;
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      return j + 1;
    }
  }
  throw new Error(`Unterminated tag at offset ${from}`);
}

export const child = (node: XmlElement, name: string) => node.children.find((c) => c.name === name);

export const children = (node: XmlElement, name: string) => node.children.filter((c) => c.name === name);

/** Text content of a leaf element. For the WSDL shapes rs.ge uses, text and child elements never mix. */
export const textOf = (node: XmlElement) => node.text;

export const isNil = (node: XmlElement) => node.attrs.nil === 'true';

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
