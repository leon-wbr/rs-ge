import { describe, expect, it } from 'vitest';
import { anonymiseXml } from '../scripts/anonymise.ts';

const xml =
  '<r><SaidCode>206322102</SaidCode><Name>ლეონ ვებერი</Name><Addr>206322102 ლეონ</Addr><Amount>1234.50</Amount><Year>2026</Year><Rate>0.01</Rate></r>';

describe('anonymiseXml', () => {
  it('replaces every identifier with a stable fake of the same shape', () => {
    const out = anonymiseXml(xml, { identifiers: ['206322102', 'ლეონ ვებერი', 'ლეონ'], factor: 1 });
    expect(out).not.toContain('206322102');
    expect(out).not.toContain('ლეონ');
    const tin = /<SaidCode>(\d{9})<\/SaidCode>/.exec(out)![1];
    expect(out).toContain(`<Addr>${tin} `);
    expect(anonymiseXml(xml, { identifiers: ['206322102', 'ლეონ ვებერი', 'ლეონ'], factor: 1 })).toBe(out);
  });

  it('scales decimal amounts but leaves integers like years alone', () => {
    const out = anonymiseXml(xml, { identifiers: [], factor: 0.5 });
    expect(out).toContain('<Amount>617.25</Amount>');
    expect(out).toContain('<Year>2026</Year>');
    expect(out).toContain('<Rate>0.01</Rate>');
  });
});
