import { assertCalendarDate, formatRsDate, type CalendarDate } from './dates.ts';
import { RsGeAuthError, RsGeServiceError, RsGeShapeError } from './errors.ts';
import { invoicesSchema, type InvoicesOperations } from './generated/invoices.ts';
import {
  taxpayerSchema,
  type ActOfComparison,
  type OrgRevenue,
  type PayerInfo,
  type TaxpayerOperations,
  type TPInfoPublic,
  type ZReportSumProperties,
  type ZreportDetails,
} from './generated/taxpayer.ts';
import { waybillSchema, type WaybillOperations } from './generated/waybill.ts';
import type { Decimal } from './money.ts';
import type { ServiceSchema } from './schema.ts';
import { invoke, type TransportOptions } from './soap.ts';

/** A service user: `username` is the full `su` (usually `name:TIN`), `password` its `sp`. */
export interface ServiceUser {
  username: string;
  password: string;
}

const SCHEMAS = { taxpayer: taxpayerSchema, waybill: waybillSchema, invoices: invoicesSchema } satisfies Record<string, ServiceSchema>;

type Service = keyof typeof SCHEMAS;
interface Operations {
  taxpayer: TaxpayerOperations;
  waybill: WaybillOperations;
  invoices: InvoicesOperations;
}

/** The field names each operation uses for the service user, in all the spellings rs.ge has. */
const USERNAME_FIELDS = new Set(['su', 'userName', 'UserName', 'Username', 'user', 'inUserName']);
const PASSWORD_FIELDS = new Set(['sp', 'password', 'Password', 'inPassword']);

/** These take the taxpayer's main portal password. rs-ge never handles it. */
const MAIN_ACCOUNT_OPERATIONS = new Set([
  'create_service_user',
  'update_service_user',
  'get_service_users',
  'create_ser_user',
  'update_ser_user',
  'get_ser_users',
]);

/** Operations that change state on rs.ge. Everything else is treated as a read and may be retried. */
const WRITE_PREFIXES = /^(save|send|close|ref|del|delete|confirm|reject|change|acsept|k_invoice|add_inv|attach|detach|update|create|Payer_Info_Activation|Tp_sms|Gita_|Customs_)/;

type Credentialless<T> = Omit<T, 'su' | 'sp' | 'userName' | 'UserName' | 'Username' | 'user' | 'inUserName' | 'password' | 'Password' | 'inPassword'>;

interface StatusShape {
  ResponseStatus?: boolean | null;
  Error?: { ErrorCode: number | null; ErrorDescription: string | null } | null;
}

/**
 * TaxPayer results report failure in-band: `ResponseStatus: false` plus an
 * error code and a (Georgian) description, either on the result itself or on
 * a nested `Response`/`response`.
 */
function assertTaxpayerStatus(operation: string, result: StatusShape & { Response?: StatusShape | null; response?: StatusShape | null }): void {
  const status = result.Response ?? result.response ?? result;
  if (status.ResponseStatus !== false) return;
  const code = status.Error?.ErrorCode ?? undefined;
  const description = status.Error?.ErrorDescription ?? undefined;
  throw new RsGeServiceError(`${operation}: rs.ge returned error ${code ?? '(no code)'}${description ? `: ${description}` : ''}`, {
    service: 'taxpayer',
    operation,
    code,
    description,
  });
}

function required<T>(operation: string, service: string, value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) {
    throw new RsGeShapeError(`${operation}: response has no ${what}`, { service, operation, xml: '' });
  }
  return value;
}

export interface RsGeClient {
  /**
   * Call any operation by name with the service user filled in. Typed from the
   * WSDL; results are returned as rs.ge sends them, without status checks.
   */
  call<S extends Service, O extends keyof Operations[S] & string>(
    service: S,
    operation: O,
    input?: Credentialless<Operations[S][O] extends { input: infer I } ? I : never>,
  ): Promise<Operations[S][O] extends { output: infer R } ? R : never>;

  /** Check the service user. Returns rs.ge's internal id of the taxpayer and of the service user. */
  checkServiceUser(): Promise<{ unId: number; serviceUserId: number }>;
  /** The public IP address rs.ge sees for these requests, for an IP-bound service user. */
  whatIsMyIp(): Promise<string>;

  taxpayer: {
    /** Declared income for a calendar year. Documented by rs.ge. */
    incomeAmount(year: number): Promise<{ amount: Decimal | null }>;
    /** The caller's own snapshot: income declaration, per-tax balance card, monthly salary, waybill and invoice totals. Undocumented. */
    quickCashInfo(): Promise<OrgRevenue>;
    /** Status, declarations, comparison act, cash boxes and more for a TIN. Undocumented; may need activation. */
    payerInfo(tin: string): Promise<PayerInfo>;
    /** Per-tax balance movements (opening, accrued, paid, closing) over an inclusive date range. Undocumented. */
    comparisonAct(input: { tin: string; from: CalendarDate; to: CalendarDate }): Promise<ActOfComparison[]>;
    /** Public registry data for a TIN: name, legal form, status, VAT status. */
    publicInfo(tin: string): Promise<TPInfoPublic>;
    /** Cash register totals over an inclusive date range. Documented by rs.ge. */
    zReportSum(input: { from: CalendarDate; to: CalendarDate }): Promise<ZReportSumProperties>;
    /** Cash register Z-reports over an inclusive date range. Documented by rs.ge. */
    zReportDetails(input: { from: CalendarDate; to: CalendarDate }): Promise<ZreportDetails[]>;
  };

  waybill: {
    serverTime(): Promise<string | null>;
    isVatPayer(tin: string): Promise<boolean>;
    nameFromTin(tin: string): Promise<string | null>;
    tinFromUnId(unId: number): Promise<string | null>;
  };

  invoices: {
    /** The e-invoice service's user id for this service user, needed by every invoice call. */
    userId(): Promise<number>;
  };
}

export interface RsGeOptions extends TransportOptions {}

export function createRsGe(serviceUser: ServiceUser, options: RsGeOptions = {}): RsGeClient {
  // Kept in this closure only, so neither JSON.stringify nor console.log of the client reveals them.
  const { username, password } = serviceUser;
  if (!username || !password) throw new TypeError('A service user needs a username and a password');

  async function call(service: Service, operation: string, input: Record<string, unknown> = {}): Promise<never> {
    if (MAIN_ACCOUNT_OPERATIONS.has(operation)) {
      throw new TypeError(`${operation} needs the main portal password; rs-ge only works with a service user`);
    }
    const schema: ServiceSchema = SCHEMAS[service];
    const op = schema.operations[operation];
    if (!op) throw new TypeError(`Unknown ${service} operation ${operation}`);
    const filled: Record<string, unknown> = { ...input };
    for (const field of op.input) {
      if (USERNAME_FIELDS.has(field.name)) filled[field.name] = username;
      if (PASSWORD_FIELDS.has(field.name)) filled[field.name] = password;
    }
    return invoke(schema, operation, filled, { ...options, idempotent: !WRITE_PREFIXES.test(operation) }) as Promise<never>;
  }

  const range = ({ from, to }: { from: CalendarDate; to: CalendarDate }) => {
    assertCalendarDate(from);
    assertCalendarDate(to);
    if (from > to) throw new RangeError(`Range starts after it ends: ${from} > ${to}`);
    return { start: formatRsDate(from), end: formatRsDate(to, { endOfDay: true }) };
  };

  const client: RsGeClient = {
    call: call as RsGeClient['call'],

    async checkServiceUser() {
      const result = await client.call('waybill', 'chek_service_user');
      const context = { service: 'waybill', operation: 'chek_service_user' };
      if (result.chek_service_userResult !== true) throw new RsGeAuthError('rs.ge rejected the service user or password', context);
      return {
        unId: required('chek_service_user', 'waybill', result.un_id, 'un_id'),
        serviceUserId: required('chek_service_user', 'waybill', result.s_user_id, 's_user_id'),
      };
    },

    async whatIsMyIp() {
      const result = await client.call('waybill', 'what_is_my_ip');
      return required('what_is_my_ip', 'waybill', result.what_is_my_ipResult, 'IP address');
    },

    taxpayer: {
      async incomeAmount(year) {
        if (!Number.isInteger(year)) throw new RangeError(`Invalid year ${year}`);
        const result = required('Get_Income_Amount', 'taxpayer', (await client.call('taxpayer', 'Get_Income_Amount', { Year: year })).Get_Income_AmountResult, 'result');
        assertTaxpayerStatus('Get_Income_Amount', result);
        return { amount: result.Amount };
      },

      async quickCashInfo() {
        const result = required('Get_QuickCash_Info', 'taxpayer', (await client.call('taxpayer', 'Get_QuickCash_Info')).Get_QuickCash_InfoResult, 'result');
        assertTaxpayerStatus('Get_QuickCash_Info', result);
        return result;
      },

      async payerInfo(tin) {
        const result = required('Get_Payer_Info', 'taxpayer', (await client.call('taxpayer', 'Get_Payer_Info', { saidCode: tin })).Get_Payer_InfoResult, 'result');
        assertTaxpayerStatus('Get_Payer_Info', result);
        return required('Get_Payer_Info', 'taxpayer', result.DataObject, 'DataObject');
      },

      async comparisonAct({ tin, ...dates }) {
        const { start, end } = range(dates);
        const result = required(
          'Get_comp_act_new',
          'taxpayer',
          (await client.call('taxpayer', 'Get_comp_act_new', { saidCode: tin, start_date: start, end_date: end })).Get_comp_act_newResult,
          'result',
        );
        assertTaxpayerStatus('Get_comp_act_new', result);
        return result.CompAct ?? [];
      },

      async publicInfo(tin) {
        const result = required('GetTPInfoPublic', 'taxpayer', (await client.call('taxpayer', 'GetTPInfoPublic', { TP_Code: tin })).GetTPInfoPublicResult, 'result');
        assertTaxpayerStatus('GetTPInfoPublic', result);
        return required('GetTPInfoPublic', 'taxpayer', result.TPInfoPublic, 'TPInfoPublic');
      },

      async zReportSum(dates) {
        const { start, end } = range(dates);
        const result = required('Get_Z_Report_Sum', 'taxpayer', (await client.call('taxpayer', 'Get_Z_Report_Sum', { StartDate: start, EndDate: end })).Get_Z_Report_SumResult, 'result');
        assertTaxpayerStatus('Get_Z_Report_Sum', result);
        return required('Get_Z_Report_Sum', 'taxpayer', result.CashData, 'CashData');
      },

      async zReportDetails(dates) {
        const { start, end } = range(dates);
        const result = required(
          'Get_Z_Report_Details',
          'taxpayer',
          (await client.call('taxpayer', 'Get_Z_Report_Details', { StartDate: start, EndDate: end })).Get_Z_Report_DetailsResult,
          'result',
        );
        assertTaxpayerStatus('Get_Z_Report_Details', result);
        return (result.ZreportDetailsData ?? []).filter((row): row is ZreportDetails => row !== null);
      },
    },

    waybill: {
      async serverTime() {
        return (await client.call('waybill', 'get_server_time')).get_server_timeResult;
      },
      async isVatPayer(tin) {
        const result = await client.call('waybill', 'is_vat_payer_tin', { tin });
        return result.is_vat_payer_tinResult === true;
      },
      async nameFromTin(tin) {
        return (await client.call('waybill', 'get_name_from_tin', { tin })).get_name_from_tinResult;
      },
      async tinFromUnId(unId) {
        return (await client.call('waybill', 'get_tin_from_un_id', { un_id: unId })).get_tin_from_un_idResult;
      },
    },

    invoices: {
      async userId() {
        // user_id is in/out: sending 0 asks rs.ge to fill it in. Not in the protocol PDF; verify on first live use.
        const result = await client.call('invoices', 'chek', { user_id: 0 });
        const context = { service: 'invoices', operation: 'chek' };
        if (result.chekResult !== true) throw new RsGeAuthError('rs.ge rejected the service user or password', context);
        return required('chek', 'invoices', result.user_id, 'user_id');
      },
    },
  };

  return client;
}

