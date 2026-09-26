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

describe('escapeXml', () => {
  it('escapes all five XML special characters', () => {
    expect(escapeXml(`<a href="x">Tom & Jerry's</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;Tom &amp; Jerry&apos;s&lt;/a&gt;');
  });
});
