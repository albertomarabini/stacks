// /frontend/merchant-dashboard/subscriptions/SubscriptionsCoordinator.ts
import { PublicInvoiceDTO, SubscriptionMode } from '/src/contracts/domain';
import type { MerchantApiHttpClient } from '/frontend/merchant-dashboard/http/MerchantApiHttpClient';

type SubItem = {
  id: string;
  subscriber: string;
  amountSats: number;
  intervalBlocks: number;
  active: boolean;
  nextInvoiceAt: number;
  lastBilledAt?: number;
  mode: SubscriptionMode;
};

export class SubscriptionsCoordinator {
  private subs: SubItem[] = [];

  public setData(subs: SubItem[]): void {
    this.subs = [...subs];
  }

  public validatePrincipal(address: string): boolean {
    return /^[ST][A-Za-z0-9]{20,}/.test(address);
  }

  public async create(
    formEl: HTMLFormElement,
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
    toSnake: (v: any) => any,
  ): Promise<{ newList: SubItem[] }> {
    const fd = new FormData(formEl);
    const subscriber = String(fd.get('subscriber') ?? '');
    const amountSats = parseInt(String(fd.get('amountSats') ?? '0'), 10);
    const intervalBlocks = parseInt(String(fd.get('intervalBlocks') ?? '0'), 10);
    const mode = String(fd.get('mode') ?? 'invoice') as SubscriptionMode;

    if (!this.validatePrincipal(subscriber)) throw new Error('Invalid subscriber principal.');
    if (!Number.isInteger(amountSats) || amountSats <= 0) throw new Error('amount_sats must be > 0.');
    if (!Number.isInteger(intervalBlocks) || intervalBlocks <= 0) throw new Error('interval_blocks must be > 0.');
    if (!(mode === 'invoice' || mode === 'direct')) throw new Error('Invalid subscription mode.');

    const body = toSnake({ subscriber, amountSats, intervalBlocks, mode });

    const sub = await http.requestJson<{
      id: string;
      idHex: string;
      storeId: string;
      merchantPrincipal: string;
      subscriber: string;
      amountSats: number;
      intervalBlocks: number;
      active: boolean;
      createdAt: number;
      lastBilledAt?: number;
      nextInvoiceAt: number;
      lastPaidInvoiceId?: string;
      mode: SubscriptionMode;
    }>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions`,
      { method: 'POST', headers: http.buildHeaders(true), body: JSON.stringify(body) },
      onAuthError,
    );

    const newItem: SubItem = {
      id: sub.id,
      subscriber: sub.subscriber,
      amountSats: sub.amountSats,
      intervalBlocks: sub.intervalBlocks,
      active: sub.active,
      nextInvoiceAt: sub.nextInvoiceAt,
      lastBilledAt: sub.lastBilledAt,
      mode: sub.mode,
    };
    return { newList: [newItem, ...this.subs] };
  }

  public async generateInvoice(
    id: string,
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
  ): Promise<{ invoice: PublicInvoiceDTO }> {
    const resp = await http.requestJson<{ invoice: PublicInvoiceDTO; magicLink: string }>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions/${encodeURIComponent(id)}/invoice`,
      { method: 'POST', headers: http.buildHeaders(true), body: JSON.stringify({}) },
      onAuthError,
    );
    return { invoice: resp.invoice };
  }

  public associateInvoiceToSub(subId: string, invoice: PublicInvoiceDTO): SubItem[] {
    return this.subs.map((s) => (s.id === subId ? { ...s, lastBilledAt: invoice.createdAt } : s));
  }

  public async cancel(
    id: string,
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
  ): Promise<SubItem[]> {
    await http.requestJson<void>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions/${encodeURIComponent(id)}/cancel`,
      { method: 'POST', headers: http.buildHeaders(true), expectJson: false as any } as any,
      onAuthError,
    );
    return this.setActive(id, false);
  }

  public setActive(id: string, active: boolean): SubItem[] {
    return this.subs.map((s) => (s.id === id ? { ...s, active } : s));
  }

  public async setMode(
    storeId: string,
    subId: string,
    mode: SubscriptionMode,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
  ): Promise<{ newList: SubItem[]; confirmed: { id: string; mode: SubscriptionMode } }> {
    if (!(mode === 'invoice' || mode === 'direct')) throw new Error('Invalid mode');
    const confirmed = await http.requestJson<{ id: string; mode: SubscriptionMode }>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/subscriptions/${encodeURIComponent(subId)}/mode`,
      { method: 'POST', headers: http.buildHeaders(true), body: JSON.stringify({ mode }) },
      onAuthError,
    );
    const newList = this.subs.map((s) => (s.id === subId ? { ...s, mode: confirmed.mode } : s));
    return { newList, confirmed };
  }
}
