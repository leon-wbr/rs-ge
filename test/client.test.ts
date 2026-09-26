import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createRsGe, type RsGeOptions } from '../src/client.ts';
import { RsGeAuthError, RsGeServiceError, RsGeTransportError } from '../src/errors.ts';
import type { Exchange } from '../src/soap.ts';

const PASSWORD = 'S3cret<&>pw';
const fixture = (name: string) => readFileSync(new URL(`../fixtures/synthetic/${name}.xml`, import.meta.url), 'utf8');

interface Sent {
  url: string;
  headers: Record<string, string>;
  body: string;
}

function fakeRs(...responses: Array<string | { status: number; body: string }>) {
  const sent: Sent[] = [];
  const exchanges: Exchange[] = [];
  const fetch: typeof globalThis.fetch = async (url, init) => {
    sent.push({ url: String(url), headers: init?.headers as Record<string, string>, body: String(init?.body) });
    const next = responses.shift();
    if (next === undefined) throw new Error('No more responses');
    const { status, body } = typeof next === 'string' ? { status: 200, body: next } : next;
    return new Response(body, { status, headers: { 'Content-Type': 'text/xml; charset=utf-8' } });
  };
  const options: RsGeOptions = { fetch, onExchange: (e) => exchanges.push(e) };
  return { rs: createRsGe({ username: 'kartell:206322102', password: PASSWORD }, options), sent, exchanges };
}

describe('checkServiceUser', () => {
  it('returns the ids rs.ge reports, sending su/sp to the waybill service', async () => {
    const { rs, sent } = fakeRs(fixture('chek_service_user.ok'));
    await expect(rs.checkServiceUser()).resolves.toEqual({ unId: 731937, serviceUserId: 4521 });
    expect(sent[0]!.url).toBe('https://services.rs.ge/WayBillService/WayBillService.asmx');
    expect(sent[0]!.headers.SOAPAction).toBe('"http://tempuri.org/chek_service_user"');
    expect(sent[0]!.body).toContain('<chek_service_user xmlns="http://tempuri.org/"><su>kartell:206322102</su><sp>S3cret&lt;&amp;&gt;pw</sp></chek_service_user>');
  });

  it('throws an auth error when rs.ge rejects the service user', async () => {
    const { rs } = fakeRs(fixture('chek_service_user.rejected'));
    await expect(rs.checkServiceUser()).rejects.toBeInstanceOf(RsGeAuthError);
  });
});

describe('taxpayer', () => {
  it('uses the TaxPayer namespace and field spelling, and returns the amount as a decimal string', async () => {
    const { rs, sent } = fakeRs(fixture('Get_Income_Amount.ok'));
    await expect(rs.taxpayer.incomeAmount(2025)).resolves.toEqual({ amount: '48210.55' });
    expect(sent[0]!.headers.SOAPAction).toBe('"services.rs.ge/Get_Income_Amount"');
    expect(sent[0]!.body).toContain('<Get_Income_Amount xmlns="services.rs.ge"><UserName>kartell:206322102</UserName><Password>');
    expect(sent[0]!.body).toContain('<Year>2025</Year>');
  });

  it('turns ResponseStatus=false into a service error with rs.ge’s code and Georgian description', async () => {
    const { rs } = fakeRs(fixture('Get_Income_Amount.error'));
    const error = await rs.taxpayer.incomeAmount(2025).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RsGeServiceError);
    expect(error).toMatchObject({ code: 12, description: 'მომხმარებელს არ აქვს უფლება', operation: 'Get_Income_Amount' });
  });

  it('decodes arrays of one as arrays, nil as null and doubles without float loss', async () => {
    const { rs } = fakeRs(fixture('Get_QuickCash_Info.ok'));
    const info = await rs.taxpayer.quickCashInfo();
    expect(info.CompCard).toEqual([{ name: 'საშემოსავლო გადასახადი', ficedCapital: '0.00', fine: '0', penaltyTax: '0', surplus: '12.40' }]);
    expect(info.IncomeDeclaration).toEqual({ NaceCode: ['62.01'], creditPay: null, totalRevenue: '48210.55', year: '2025' });
    expect(info.InvoiceMonthly?.map((m) => m?.Amount)).toEqual(['1500.00', '0.00001']);
    expect(info.VatDeclaration).toBeNull();
  });

  it('sends inclusive date ranges as Tbilisi local times', async () => {
    const { rs, sent } = fakeRs(fixture('Get_Income_Amount.ok').replaceAll('Get_Income_Amount', 'Get_comp_act_new'));
    await rs.taxpayer.comparisonAct({ tin: '206322102', from: '2026-05-01', to: '2026-05-31' });
    expect(sent[0]!.body).toContain('<saidCode>206322102</saidCode><start_date>2026-05-01T00:00:00</start_date><end_date>2026-05-31T23:59:59</end_date>');
    await expect(rs.taxpayer.comparisonAct({ tin: '1', from: '2026-06-01', to: '2026-05-01' })).rejects.toThrow(RangeError);
  });
});

describe('transport', () => {
  it('retries reads on 5xx, then succeeds', async () => {
    const { rs, sent } = fakeRs({ status: 503, body: 'busy' }, fixture('chek_service_user.ok'));
    await expect(rs.checkServiceUser()).resolves.toMatchObject({ unId: 731937 });
    expect(sent).toHaveLength(2);
  });

  it('never retries a write', async () => {
    const { rs, sent } = fakeRs({ status: 503, body: 'busy' });
    await expect(rs.call('waybill', 'send_waybill', { waybill_id: 1 })).rejects.toBeInstanceOf(RsGeTransportError);
    expect(sent).toHaveLength(1);
  });

  it('reports SOAP faults as transport errors', async () => {
    const { rs } = fakeRs({ status: 500, body: fixture('fault') });
    await expect(rs.taxpayer.quickCashInfo()).rejects.toThrow(/Object reference not set/);
  });

  it('refuses operations that need the main portal password', async () => {
    const { rs } = fakeRs();
    await expect(rs.call('waybill', 'get_service_users')).rejects.toThrow(/main portal password/);
  });
});

describe('credential hygiene', () => {
  it('never exposes the password in exchanges, errors or the client object', async () => {
    const { rs, exchanges } = fakeRs(fixture('Get_Income_Amount.error'), { status: 500, body: fixture('fault') });
    const errors = [await rs.taxpayer.incomeAmount(2025).catch((e: unknown) => e), await rs.taxpayer.quickCashInfo().catch((e: unknown) => e)];
    const everything = JSON.stringify([exchanges, errors.map((e) => [String(e), (e as Error).stack]), rs]) + String(rs);
    expect(everything).not.toContain('S3cret');
    expect(exchanges[0]!.request).toContain('<Password>***</Password>');
  });
});
