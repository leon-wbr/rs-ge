import { describe, expect, it } from 'vitest';
import { child, children, parseXml, textOf, isNil, escapeXml } from '../src/xml.ts';

describe('parseXml', () => {
  it('parses nested elements, strips namespace prefixes and keeps attributes', () => {
    const root = parseXml(
      `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="x"><soap:Body><A b="1"><C>hi</C><C>there</C></A></soap:Body></soap:Envelope>`,
    );
    expect(root.name).toBe('Envelope');
    const a = child(child(root, 'Body')!, 'A')!;
    expect(a.attrs.b).toBe('1');
    expect(children(a, 'C').map(textOf)).toEqual(['hi', 'there']);
  });

  it('decodes entities, numeric references and CDATA', () => {
    const root = parseXml(`<r>a &lt;b&gt; &amp; &quot;c&quot; &apos;d&apos; &#4304;&#x10D1; <![CDATA[<raw & text>]]></r>`);
    expect(textOf(root)).toBe(`a <b> & "c" 'd' აბ <raw & text>`);
  });

  it('keeps Georgian text byte-exact', () => {
    expect(textOf(parseXml('<n>საშემოსავლო გადასახადი</n>'))).toBe('საშემოსავლო გადასახადი');
  });

  it('handles self-closing elements, comments and xsi:nil', () => {
    const root = parseXml(`<r><!-- note --><a/><b xsi:nil="true" /><c></c></r>`);
    expect(child(root, 'a')).toBeDefined();
    expect(isNil(child(root, 'b')!)).toBe(true);
    expect(textOf(child(root, 'c')!)).toBe('');
  });

  it('rejects DOCTYPE declarations', () => {
    expect(() => parseXml('<!DOCTYPE x [<!ENTITY a "b">]><r/>')).toThrow(/DOCTYPE/);
  });

  it('rejects mismatched tags', () => {
    expect(() => parseXml('<a><b></a></b>')).toThrow(/mismatched/i);
  });
});

describe('parseXml edge cases', () => {
  it('reads single-quoted attributes, prefixed attribute names and ">" inside attribute values', () => {
    const root = parseXml(`<r a='1' xsi:b="x>y" c = "&amp;"><k/></r>`);
    expect(root.attrs).toEqual({ a: '1', b: 'x>y', c: '&' });
    expect(root.children).toHaveLength(1);
  });

  it('keeps text split by child elements or comments in one text value', () => {
    expect(textOf(parseXml('<r>a<!-- x -->b<![CDATA[c]]>d</r>'))).toBe('abcd');
  });

  it('does not decode entities inside CDATA', () => {
    expect(textOf(parseXml('<r><![CDATA[&amp; &bogus;]]></r>'))).toBe('&amp; &bogus;');
  });

  it('ignores whitespace and the XML declaration around the root', () => {
    expect(parseXml('\n <?xml version="1.0"?>\n<r/>\n').name).toBe('r');
  });

  it('rejects unknown entities', () => {
    expect(() => parseXml('<r>&nbsp;</r>')).toThrow(/Unknown XML entity &nbsp;/);
  });

  it.each([
    ['', /No root element/],
    ['<a>', /Unclosed element <a>/],
    ['<a/><b/>', /More than one root/],
    ['x<a/>', /Text outside the root/],
    ['<a><!-- open</a>', /Unterminated markup/],
    ['<a b="1></a>', /Unterminated tag/],
    ['<a></b>', /Mismatched closing tag <\/b>, expected <\/a>/],
    ['<>', /Malformed tag/],
  ])('rejects malformed input %j', (xml, message) => {
    expect(() => parseXml(xml)).toThrow(message);
  });

  it('matches closing tags on the full prefixed name', () => {
    expect(() => parseXml('<a:r></b:r>')).toThrow(/Mismatched/);
    expect(parseXml('<a:r></a:r>').name).toBe('r');
  });

  it('isNil only honours xsi:nil="true"', () => {
    const root = parseXml('<r><a xsi:nil="false"/><b xsi:nil="1"/><c nil="true"/></r>');
    expect(root.children.map(isNil)).toEqual([false, false, true]);
  });
});

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
  });
});
