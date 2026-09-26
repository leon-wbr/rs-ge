# rs-ge

A typed TypeScript client for the SOAP services of Georgia's Revenue Service (rs.ge): the TaxPayer service, the WayBill service and the NTOS e-invoice service. It authenticates with a **service user** (სერვისის მომხმარებელი), the limited login a taxpayer creates in their rs.ge account for software, and never with the main portal password.

- No runtime dependencies. It only needs `fetch`, so it runs on Node 22+, Cloudflare Workers, Deno and Bun.
- Every operation of all three services is typed, generated from the WSDLs rs.ge publishes.
- Amounts stay decimal strings (`'1234.50'`) from the wire to your code, so no floating-point rounding reaches a tax figure. `toTetri()` converts to integer minor units.
- Dates are plain `YYYY-MM-DD` strings in and out, interpreted as Tbilisi time (UTC+4), the way the services do.
- Passwords are redacted from every log hook, error and fixture, and the client object doesn't expose them.

> **Unofficial.** This project isn't affiliated with or endorsed by the Revenue Service. rs.ge documents the WayBill and e-invoice services and two TaxPayer methods; the other TaxPayer methods appear only in the service's WSDL. Methods are marked below by how much is known about them. Use it only with a service user of the taxpayer whose data you're reading.

## Install

```sh
npm install rs-ge
```

## Use

```ts
import { createRsGe } from 'rs-ge';

const rs = createRsGe({ username: 'myapp:206322102', password: process.env.RSGE_PASSWORD! });

await rs.checkServiceUser(); // { unId: 731937, serviceUserId: 4521 }
await rs.taxpayer.incomeAmount(2025); // { amount: '48210.55' }
await rs.taxpayer.comparisonAct({ tin: '206322102', from: '2026-01-01', to: '2026-05-31' });
```

`username` is the full service-user name as the portal shows it, usually `name:TIN`.

Any operation can be called by name, typed from the WSDL, with the service user filled in:

```ts
const { get_waybillsResult } = await rs.call('waybill', 'get_waybills', {
  create_date_s: '2026-05-01T00:00:00',
  create_date_e: '2026-05-31T23:59:59',
});
```

`call` returns results exactly as rs.ge sends them. The named methods also check rs.ge's status fields and throw typed errors.

### Options

```ts
createRsGe(serviceUser, {
  fetch,          // your fetch, e.g. for tests or a proxy
  timeoutMs,      // per attempt, default 30 000
  retries,        // extra attempts for reads on network errors, timeouts and 5xx; default 2. Writes are never retried.
  endpoints,      // { taxpayer?, waybill?, invoices? } to override a service URL
  onExchange,     // (exchange) => void; sees each request and response with passwords already redacted
});
```

### Errors

All errors extend `RsGeError` and carry `service` and `operation`.

| Error | Meaning |
|---|---|
| `RsGeAuthError` | rs.ge rejected the service user or password. Don't retry with the same credentials. |
| `RsGeServiceError` | rs.ge returned an error status. `code` and `description` (usually Georgian) are as rs.ge sent them. A missing permission or an IP restriction shows up here until its codes are known. |
| `RsGeTransportError` | Network failure, timeout, HTTP error or SOAP fault. |
| `RsGeShapeError` | The response doesn't match the WSDL shape. `xml` holds the redacted response. |

## Methods

| Method | Operation | Status |
|---|---|---|
| `checkServiceUser()` | WayBill `chek_service_user` | documented |
| `whatIsMyIp()` | WayBill `what_is_my_ip` | documented |
| `taxpayer.incomeAmount(year)` | `Get_Income_Amount` | documented |
| `taxpayer.zReportSum({ from, to })` | `Get_Z_Report_Sum` | documented |
| `taxpayer.zReportDetails({ from, to })` | `Get_Z_Report_Details` | documented |
| `taxpayer.quickCashInfo()` | `Get_QuickCash_Info` | WSDL only |
| `taxpayer.payerInfo(tin)` | `Get_Payer_Info` | WSDL only |
| `taxpayer.comparisonAct({ tin, from, to })` | `Get_comp_act_new` | WSDL only |
| `taxpayer.publicInfo(tin)` | `GetTPInfoPublic` | WSDL only |
| `waybill.nameFromTin(tin)` | `get_name_from_tin` | documented |
| `waybill.serverTime()`, `isVatPayer(tin)`, `tinFromUnId(unId)` | `get_server_time`, `is_vat_payer_tin`, `get_tin_from_un_id` | WSDL only |
| `invoices.userId()` | NTOS `chek` | documented; the `user_id = 0` lookup is unverified |

"Documented" means rs.ge publishes a protocol for it. "WSDL only" means the operation is published in the service's WSDL but has no protocol document. No method has been verified against a live account yet; this table will say when one has.

rs-ge deliberately doesn't wrap `create_service_user`, `get_service_users` and the other operations that take the main portal password. `call` refuses them.

## Creating a service user

Log in at eservices.rs.ge, open **მომხმარებლების მართვა** (User management), click **ახალი მომხმარებელი** (New user) and choose **ქვე-მომხმარებელი** (sub-user). Set a name, username and password, leave **IP მისამართი** empty unless your server has a fixed address, and tick only the permissions your software needs in **უფლებები**. After saving, the locked **სერვის მომხმარებელი** field shows the full username to use.

## Probe

To see which methods answer for a service user, without printing any values:

```sh
RSGE_USERNAME='myapp:206322102' RSGE_PASSWORD='…' npx rs-ge probe
```

`--record <dir>` also saves each redacted response to `<dir>/<operation>.raw.xml`. Those files still contain the taxpayer's data; anonymise them before sharing.

## Development

```sh
pnpm install
pnpm test          # unit tests against synthetic fixtures
pnpm typecheck
pnpm generate      # regenerate src/generated from wsdl/
pnpm wsdl:check    # compare wsdl/ with what rs.ge serves now
```

`fixtures/synthetic` holds responses shaped from the WSDLs with invented values. Recorded responses go in `fixtures/recorded` only after `scripts/anonymise.ts` has replaced every identifier with a stable fake and scaled the amounts:

```sh
RSGE_IDENTIFIERS='206322102,Name Surname' RSGE_SCALE=0.83 node scripts/anonymise.ts recorded/Get_QuickCash_Info.raw.xml fixtures/recorded/Get_QuickCash_Info.xml
```

## Licence

MIT
