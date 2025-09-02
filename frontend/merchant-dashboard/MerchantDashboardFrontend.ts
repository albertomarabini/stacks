// ../merchant-dashboard/MerchantDashboardFrontend.ts
import { RequestShapeAdapter } from '../merchant-dashboard/adapters/RequestShapeAdapter';
import { MerchantApiHttpClient } from '../merchant-dashboard/http/MerchantApiHttpClient';
import { RefundFlowCoordinator } from '../merchant-dashboard/flows/RefundFlowCoordinator';
import { InvoiceListViewModel } from '../merchant-dashboard/viewmodels/InvoiceListViewModel';
import { SubscriptionsCoordinator } from '../merchant-dashboard/subscriptions/SubscriptionsCoordinator';
import { WebhookConsoleCoordinator } from '../merchant-dashboard/webhooks/WebhookConsoleCoordinator';
import { StoreProfileCoordinator } from '../merchant-dashboard/profile/StoreProfileCoordinator';
import { KeyRotationCoordinator } from '../merchant-dashboard/keys/KeyRotationCoordinator';
import {
  PublicInvoiceDTO,
  StorePrivateProfileDTO,
  SubscriptionMode,
  InvoiceStatus,
  UnsignedContractCall,
} from '../../src/contracts/domain';

type SubscriptionItem = {
  id: string;
  subscriber: string;
  amountSats: number;
  intervalBlocks: number;
  active: boolean;
  nextInvoiceAt: number;
  lastBilledAt?: number;
  mode: SubscriptionMode;
};

type OneTimeSecrets = { apiKey: string; hmacSecret: string };

type DashboardState = {
  storeId: string;
  apiKey: string;
  invoices: PublicInvoiceDTO[];
  filteredInvoices: PublicInvoiceDTO[];
  invoiceDetail?: PublicInvoiceDTO;
  subscriptions: SubscriptionItem[];
  profile?: StorePrivateProfileDTO;
  webhookLogs: any[];
  testResult?: 'success' | 'failure';
  refundDialog?: any;
  oneTimeSecrets?: OneTimeSecrets | null;
  sortDirection: 'asc' | 'desc';
  refetchKey: number;
  authError: boolean;
};

const requestShapeAdapter = new RequestShapeAdapter();
const http = new MerchantApiHttpClient();
const refundFlow = new RefundFlowCoordinator();
const listVm = new InvoiceListViewModel();
const subsCoord = new SubscriptionsCoordinator();
const webhookCoord = new WebhookConsoleCoordinator();
const storeProfileCoord = new StoreProfileCoordinator();
const keyRotator = new KeyRotationCoordinator();

export const state: DashboardState = {
  storeId: '',
  apiKey: '',
  invoices: [],
  filteredInvoices: [],
  subscriptions: [],
  webhookLogs: [],
  sortDirection: 'desc',
  refetchKey: 0,
  authError: false,
};

export async function handleCreateInvoice(e: React.FormEvent<HTMLFormElement>): Promise<void> {
  e.preventDefault();
  const fd = new FormData(e.currentTarget);
  const amountSats = parseInt(String(fd.get('amountSats') ?? '0'), 10);
  const ttlSeconds = parseInt(String(fd.get('ttlSeconds') ?? '0'), 10);
  const memo = fd.get('memo') ? String(fd.get('memo')) : undefined;
  const webhookUrl = fd.get('webhookUrl') ? String(fd.get('webhookUrl')) : undefined;

  if (!Number.isInteger(amountSats) || amountSats <= 0) {
    throw new Error('amount_sats must be > 0');
  }
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error('ttl_seconds must be > 0');
  }
  if (memo) {
    const bytes = new TextEncoder().encode(memo);
    if (bytes.length > 34) throw new Error('memo must be ≤ 34 bytes (UTF-8).');
  }

  http.setContext({ storeId: state.storeId, apiKey: state.apiKey });
  const body = requestShapeAdapter.toSnake({ amountSats, ttlSeconds, memo, webhookUrl });
  const created = await http.requestJson<PublicInvoiceDTO>(
    `/api/v1/stores/${state.storeId}/invoices`,
    { method: 'POST', headers: http.buildHeaders(true), body: JSON.stringify(body) },
    onErrorAuthGate,
  );

  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { invoices, filtered } = listVm.updateAfterCreate(created);
  state.invoices = invoices;
  state.filteredInvoices = filtered;
  state.refetchKey++;
}

export function toSnake<T extends Record<string, any>>(camel: T): Record<string, any> {
  return requestShapeAdapter.toSnake(camel);
}

export function updateInvoicesList(created: PublicInvoiceDTO): void {
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { invoices, filtered } = listVm.updateAfterCreate(created);
  state.invoices = invoices;
  state.filteredInvoices = filtered;
}

export async function onCancelInvoice(invoiceId: string): Promise<void> {
  http.setContext({ storeId: state.storeId, apiKey: state.apiKey });
  await http.requestJson<void>(
    `/api/v1/stores/${state.storeId}/invoices/${invoiceId}/cancel`,
    { method: 'POST', headers: http.buildHeaders(false), expectJson: false as any } as any,
    onErrorAuthGate,
  );
  setInvoiceStatus(invoiceId, 'canceled');
  state.refetchKey++;
}

export function setInvoiceStatus(invoiceId: string, statusValue: InvoiceStatus): void {
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { invoices, filtered } = listVm.setStatus(invoiceId, statusValue);
  state.invoices = invoices;
  state.filteredInvoices = filtered;
}

export function openRefundDialog(invoice: PublicInvoiceDTO): void {
  state.refundDialog = refundFlow.openDialog(invoice);
}

export async function handleRefundSubmit(e: React.FormEvent<HTMLFormElement>): Promise<void> {
  e.preventDefault();
  const { newState, unsignedCall } = await refundFlow.submit(
    e.currentTarget as HTMLFormElement,
    state.refundDialog,
    state.storeId,
    http as any,
    onErrorAuthGate,
    requestShapeAdapter.toSnake.bind(requestShapeAdapter),
  );
  state.refundDialog = newState;
  if (unsignedCall) {
    refundFlow.invokeWallet(unsignedCall, {
      onFinish: (tx?: unknown) => onRefundTxFinish(tx),
      onCancel: () => onRefundTxCancel(),
    });
  }
}

export async function invokeWalletOpenContractCall(payload: UnsignedContractCall): Promise<void> {
  refundFlow.invokeWallet(payload, {
    onFinish: (tx?: unknown) => onRefundTxFinish(tx),
    onCancel: () => onRefundTxCancel(),
  });
}

export function onRefundTxFinish(_tx?: unknown): void {
  const out = refundFlow.onFinish(state.refundDialog);
  state.refundDialog = out.newState;
  if (out.shouldRefetch) state.refetchKey++;
}

export function onRefundTxCancel(): void {
  state.refundDialog = refundFlow.onCancel(state.refundDialog);
}

export function closeRefundDialog(): void {
  state.refundDialog = refundFlow.closeDialog();
}

export async function handleCreateSubscription(e: React.FormEvent<HTMLFormElement>): Promise<void> {
  e.preventDefault();
  subsCoord.setData(state.subscriptions);
  const out = await subsCoord.create(
    e.currentTarget as HTMLFormElement,
    state.storeId,
    http as any,
    onErrorAuthGate,
    requestShapeAdapter.toSnake.bind(requestShapeAdapter),
  );
  state.subscriptions = out.newList as SubscriptionItem[];
  state.refetchKey++;
}

export function validatePrincipal(address: string): boolean {
  return subsCoord.validatePrincipal(address);
}

export async function generateInvoiceForSubscription(id: string): Promise<void> {
  subsCoord.setData(state.subscriptions);
  const { invoice } = await subsCoord.generateInvoice(id, state.storeId, http as any, onErrorAuthGate);
  state.subscriptions = subsCoord.associateInvoiceToSub(id, invoice) as SubscriptionItem[];
  state.refetchKey++;
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { invoices, filtered } = listVm.updateAfterCreate(invoice);
  state.invoices = invoices;
  state.filteredInvoices = filtered;
}

export function associateInvoiceToSubscription(subId: string, invoice: PublicInvoiceDTO): void {
  subsCoord.setData(state.subscriptions);
  state.subscriptions = subsCoord.associateInvoiceToSub(subId, invoice) as SubscriptionItem[];
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { invoices, filtered } = listVm.updateAfterCreate(invoice);
  state.invoices = invoices;
  state.filteredInvoices = filtered;
}

export async function cancelSubscription(id: string): Promise<void> {
  subsCoord.setData(state.subscriptions);
  state.subscriptions = (await subsCoord.cancel(id, state.storeId, http as any, onErrorAuthGate)) as SubscriptionItem[];
  state.refetchKey++;
}

export function setSubscriptionActive(id: string, active: boolean): void {
  subsCoord.setData(state.subscriptions);
  state.subscriptions = subsCoord.setActive(id, active) as SubscriptionItem[];
}

export async function handleSaveStoreSettings(e: React.FormEvent<HTMLFormElement>): Promise<void> {
  e.preventDefault();
  storeProfileCoord.setProfileLocal(state.profile);
  const prof = await storeProfileCoord.save(
    e.currentTarget as HTMLFormElement,
    state.storeId,
    http as any,
    onErrorAuthGate,
    requestShapeAdapter.toSnake.bind(requestShapeAdapter),
  );
  setProfile(prof);
}

export function setProfile(profile: StorePrivateProfileDTO): void {
  storeProfileCoord.setProfileLocal(profile);
  state.profile = profile;
}

export async function testWebhook(): Promise<void> {
  webhookCoord.setData(state.webhookLogs as any[], state.testResult);
  const res = await webhookCoord.test(state.storeId, http as any, onErrorAuthGate);
  state.testResult = res;
  state.webhookLogs = await webhookCoord.fetchLogs(state.storeId, http as any, onErrorAuthGate);
}

export function setTestResult(result: 'success' | 'failure'): void {
  webhookCoord.setData(state.webhookLogs as any[], state.testResult);
  state.testResult = webhookCoord.setTestResult(result);
}

export async function fetchWebhookLogs(invoiceIdFilter?: string): Promise<void> {
  webhookCoord.setData(state.webhookLogs as any[], state.testResult);
  state.webhookLogs = await webhookCoord.fetchLogs(state.storeId, http as any, onErrorAuthGate, invoiceIdFilter);
}

export async function rotateKeys(): Promise<void> {
  const secrets = await keyRotator.rotate(state.storeId, http as any, onErrorAuthGate);
  state.oneTimeSecrets = keyRotator.show(secrets);
}

export function showOneTimeSecretsModal(secrets: { apiKey: string; hmacSecret: string }): void {
  state.oneTimeSecrets = keyRotator.show(secrets);
}

export function clearOneTimeSecrets(): void {
  state.oneTimeSecrets = keyRotator.clear();
}

export function toggleSort(field: 'createdAt'): void {
  if (field !== 'createdAt') return;
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const newDir = listVm.toggleSort();
  state.sortDirection = newDir;
  state.filteredInvoices = listVm.sortByCreatedAt(newDir).filtered;
}

export function sortInvoicesByCreatedAt(direction: 'asc' | 'desc'): void {
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { filtered } = listVm.sortByCreatedAt(direction);
  state.filteredInvoices = filtered;
}

export function applyInvoiceStatusFilter(value: InvoiceStatus | 'all'): void {
  listVm.setData(state.invoices, state.filteredInvoices, state.sortDirection);
  const { filtered } = listVm.applyFilter(value);
  listVm.setData(state.invoices, filtered, state.sortDirection);
  state.filteredInvoices = listVm.sortByCreatedAt(state.sortDirection).filtered;
}

export function setFilteredInvoices(list: PublicInvoiceDTO[]): void {
  state.filteredInvoices = list;
}

export function exportCsv(): void {
  const rows = state.filteredInvoices.map((i) => ({
    invoiceId: i.invoiceId,
    amountSats: i.amountSats,
    usdAtCreate: i.usdAtCreate,
    status: i.status,
    txId: i.txId ?? '',
    createdAt: i.createdAt,
    refundAmount: i.refundAmount ?? '',
    refundTxId: i.refundTxId ?? '',
  }));
  listVm.exportCsv(rows as any);
}

export function toCsv(rows: Array<{ invoiceId: string; amountSats: number; usdAtCreate: number; status: InvoiceStatus; txId?: string; createdAt: number; refundAmount?: number; refundTxId?: string }>): string {
  return listVm.toCsv(rows as any);
}

export function openInExplorer(txId: string): void {
  if (!txId) throw new Error('txId required');
  const base =
    (window as any).__EXPLORER_BASE_URL__ ??
    ((typeof process !== 'undefined' && (process as any).env && (process as any).env.EXPLORER_BASE_URL) || '');
  const url = `${String(base)}/txid/${encodeURIComponent(txId)}`;
  window.open(url, '_blank', 'noopener');
}

export async function fetchInvoices(
  storeId: string,
  apiKey: string,
  options?: { status?: InvoiceStatus; signal?: AbortSignal },
): Promise<PublicInvoiceDTO[]> {
  http.setContext({ storeId, apiKey });
  const q = options?.status ? `?status=${encodeURIComponent(options.status)}` : '';
  const rows = await http.requestJson<PublicInvoiceDTO[]>(
    `/api/v1/stores/${storeId}/invoices${q}`,
    { headers: http.buildHeaders(false), signal: options?.signal },
    onErrorAuthGate,
  );
  state.invoices = rows;
  state.filteredInvoices = rows;
  sortInvoicesByCreatedAt(state.sortDirection);
  return rows;
}

export function onErrorAuthGate(error: unknown): never {
  const status = (error as any)?.response?.status ?? (error as any)?.status;
  if (status === 401 || status === 403) {
    state.authError = true;
  }
  throw error as any;
}

export async function fetchInvoice(
  storeId: string,
  invoiceId: string,
  apiKey: string,
  options?: { signal?: AbortSignal },
): Promise<PublicInvoiceDTO> {
  http.setContext({ storeId, apiKey });
  const dto = await http.requestJson<PublicInvoiceDTO>(
    `/api/v1/stores/${storeId}/invoices/${invoiceId}`,
    { headers: http.buildHeaders(false), signal: options?.signal },
    onErrorAuthGate,
  );
  state.invoiceDetail = dto;
  return dto;
}

export async function fetchSubscriptions(
  storeId: string,
  apiKey: string,
  options?: { signal?: AbortSignal },
): Promise<
  Array<{
    id: string;
    subscriber: string;
    amountSats: number;
    intervalBlocks: number;
    active: boolean;
    nextInvoiceAt: number;
    lastBilledAt?: number;
    mode: SubscriptionMode;
  }>
> {
  http.setContext({ storeId, apiKey });
  const rows = await http.requestJson<
    Array<{ id: string; subscriber: string; amountSats: number; intervalBlocks: number; active: boolean; nextInvoiceAt: number; lastBilledAt?: number; mode: SubscriptionMode }>
  >(`/api/v1/stores/${storeId}/subscriptions`, { headers: http.buildHeaders(false), signal: options?.signal }, onErrorAuthGate);
  state.subscriptions = rows as SubscriptionItem[];
  return rows;
}

export async function fetchStoreProfile(
  storeId: string,
  apiKey: string,
  options?: { signal?: AbortSignal },
): Promise<StorePrivateProfileDTO> {
  http.setContext({ storeId, apiKey });
  const prof = await http.requestJson<any>(
    `/api/v1/stores/${storeId}/profile`,
    { headers: http.buildHeaders(false), signal: options?.signal },
    onErrorAuthGate,
  );

  const normalizeAllowed = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.filter(Boolean).map((s) => String(s).trim()).filter((s) => s.length > 0);
    if (typeof v === 'string') {
      return v.split(/[\n,]/g).map((s) => s.trim()).filter((s) => s.length > 0);
    }
    return [];
  };
  prof.allowedOrigins = normalizeAllowed(prof.allowedOrigins);

  storeProfileCoord.setProfileLocal(prof as StorePrivateProfileDTO);
  state.profile = prof as StorePrivateProfileDTO;
  return prof as StorePrivateProfileDTO;
}

export async function refetch(ctx: {
  view: 'invoices' | 'invoice' | 'subscriptions' | 'webhooks';
  storeId: string;
  apiKey: string;
  invoiceId?: string;
  invoiceIdFilter?: string;
  signal?: AbortSignal;
}): Promise<void> {
  switch (ctx.view) {
    case 'invoices':
      await fetchInvoices(ctx.storeId, ctx.apiKey, { signal: ctx.signal });
      break;
    case 'invoice':
      if (!ctx.invoiceId) throw new Error('invoiceId required for view=invoice');
      await fetchInvoice(ctx.storeId, ctx.invoiceId, ctx.apiKey, { signal: ctx.signal });
      break;
    case 'subscriptions':
      await fetchSubscriptions(ctx.storeId, ctx.apiKey, { signal: ctx.signal });
      break;
    case 'webhooks':
      await fetchWebhookLogs(ctx.invoiceIdFilter);
      break;
    default:
      return;
  }

  const inv =
    state.invoiceDetail ??
    (ctx.invoiceId ? state.invoices.find((i) => i.invoiceId === ctx.invoiceId) : undefined);
  if (state.refundDialog?.pending && inv) {
    const refunded = !!inv.refundTxId || inv.status === 'refunded';
    if (refunded) state.refundDialog = refundFlow.closeDialog();
  }
}

export async function setSubscriptionMode(
  storeId: string,
  subId: string,
  mode: SubscriptionMode,
  apiKey: string,
): Promise<{ id: string; mode: SubscriptionMode }> {
  http.setContext({ storeId, apiKey });
  subsCoord.setData(state.subscriptions);
  const resp = await subsCoord.setMode(storeId, subId, mode, http as any, onErrorAuthGate);
  state.subscriptions = resp.newList as SubscriptionItem[];
  state.refetchKey++;
  return resp.confirmed;
}
