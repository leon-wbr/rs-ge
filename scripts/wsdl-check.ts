/**
 * Fetch the three public WSDLs and compare them with wsdl/. Exits 1 when rs.ge
 * changed a service, so a scheduled run can open an issue. No credentials.
 *
 *   node scripts/wsdl-check.ts [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';

const SOURCES = {
  'wsdl/taxpayer.wsdl': 'https://services.rs.ge/taxservice/taxpayerservice.asmx?WSDL',
  'wsdl/waybill.wsdl': 'https://services.rs.ge/WayBillService/WayBillService.asmx?WSDL',
  'wsdl/invoices.wsdl': 'https://www.revenue.mof.ge/ntosservice/ntosservice.asmx?WSDL',
};

const normalize = (xml: string) => xml.replace(/\r\n/g, '\n').trim();
const write = process.argv.includes('--write');
let changed = 0;

for (const [file, url] of Object.entries(SOURCES)) {
  const live = normalize(await (await fetch(url, { signal: AbortSignal.timeout(30_000) })).text());
  if (live === normalize(readFileSync(file, 'utf8'))) {
    console.log(`unchanged ${file}`);
    continue;
  }
  changed++;
  console.log(`CHANGED   ${file}`);
  if (write) writeFileSync(file, `${live}\n`);
}

if (changed && !write) console.log('\nRun with --write, then `node scripts/generate.ts`, and review the diff.');
process.exitCode = changed && !write ? 1 : 0;
