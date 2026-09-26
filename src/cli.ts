#!/usr/bin/env node
/**
 * rs-ge probe: call each read-only method once with the service user in
 * RSGE_USERNAME / RSGE_PASSWORD and report which ones answer. Prints shapes
 * (field names, list lengths), never values. With --record <dir>, saves each
 * redacted response as <dir>/<operation>.raw.xml for turning into fixtures.
 *
 *   node --env-file=$HOME/.config/rs-ge/probe.env node_modules/rs-ge/dist/cli.mjs probe --record ./recorded
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRsGe } from './client.ts';
import { periodRange } from './dates.ts';
import { RsGeError, RsGeServiceError } from './errors.ts';
import type { Exchange } from './soap.ts';

function shapeOf(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return `list(${value.length})`;
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([key, v]) => `${key}: ${v !== null && typeof v === 'object' && !Array.isArray(v) ? `{${Object.keys(v).length}}` : shapeOf(v)}`)
      .join(', ');
  }
  return typeof value;
}

async function probe(recordDir: string | undefined) {
  const username = process.env.RSGE_USERNAME;
  const password = process.env.RSGE_PASSWORD;
  if (!username || !password) {
    console.error('Set RSGE_USERNAME (the full su, e.g. name:TIN) and RSGE_PASSWORD, e.g. with node --env-file.');
    process.exit(2);
  }
  if (recordDir) mkdirSync(recordDir, { recursive: true });
  const onExchange = (exchange: Exchange) => {
    if (recordDir && exchange.response) writeFileSync(join(recordDir, `${exchange.operation}.raw.xml`), exchange.response);
  };
  const rs = createRsGe({ username, password }, { onExchange, retries: 0 });

  const now = new Date();
  const year = now.getUTCFullYear();
  const lastMonth = now.getUTCMonth() === 0 ? { year: year - 1, month: 12 } : { year, month: now.getUTCMonth() };
  let tin = process.env.RSGE_TIN;

  const steps: Array<[string, () => Promise<unknown>]> = [
    ['what_is_my_ip', () => rs.whatIsMyIp()],
    [
      'chek_service_user',
      async () => {
        const ids = await rs.checkServiceUser();
        tin ??= (await rs.waybill.tinFromUnId(ids.unId)) ?? undefined;
        return ids;
      },
    ],
    ['chek (invoices user_id)', () => rs.invoices.userId()],
    [`Get_Income_Amount ${year - 1}`, () => rs.taxpayer.incomeAmount(year - 1)],
    [`Get_Income_Amount ${year}`, () => rs.taxpayer.incomeAmount(year)],
    ['Get_QuickCash_Info', () => rs.taxpayer.quickCashInfo()],
    ['GetTPInfoPublic (own TIN)', () => rs.taxpayer.publicInfo(tin!)],
    ['Get_Payer_Info (own TIN)', () => rs.taxpayer.payerInfo(tin!)],
    [`Get_comp_act_new ${year}-01-01…`, () => rs.taxpayer.comparisonAct({ tin: tin!, from: `${year}-01-01`, to: periodRange(lastMonth).to })],
    ['Get_Z_Report_Sum last month', () => rs.taxpayer.zReportSum(periodRange(lastMonth))],
  ];

  let failures = 0;
  for (const [label, run] of steps) {
    if (label.includes('own TIN') || label.startsWith('Get_comp_act')) {
      if (!tin) {
        console.log(`– ${label}: skipped (no TIN; set RSGE_TIN)`);
        continue;
      }
    }
    try {
      console.log(`✓ ${label}: ${shapeOf(await run())}`);
    } catch (error) {
      failures++;
      if (error instanceof RsGeServiceError) console.log(`✗ ${label}: ${error.name} code=${error.code ?? '-'} ${error.description ?? ''}`);
      else if (error instanceof RsGeError) console.log(`✗ ${label}: ${error.name} ${error.message}`);
      else throw error;
    }
  }
  if (recordDir) console.log(`\nRedacted responses saved in ${recordDir}. They still hold your real data: anonymise before committing.`);
  process.exitCode = failures ? 1 : 0;
}

const [command, ...args] = process.argv.slice(2);
if (command === 'probe') {
  const at = args.indexOf('--record');
  await probe(at >= 0 ? args[at + 1] : undefined);
} else {
  console.log('Usage: rs-ge probe [--record <dir>]');
  process.exitCode = command ? 2 : 0;
}
