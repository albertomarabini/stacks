// ../merchant-dashboard/webhooks/WebhookConsoleCoordinator.ts

import type { MerchantApiHttpClient } from '../http/MerchantApiHttpClient';

export interface WebhookLogDTO {
  id: string;
  storeId: string;
  invoiceId?: string;
  subscriptionId?: string;
  eventType: string;
  payload: string;
  statusCode?: number;
  success: boolean;
  attempts: number;
  lastAttemptAt: number;
}

export class WebhookConsoleCoordinator {
  private logs: WebhookLogDTO[] = [];
  private testResult?: 'success' | 'failure';

  public setData(logs: WebhookLogDTO[], testResult?: 'success' | 'failure'): void {
    this.logs = [...logs];
    this.testResult = testResult;
  }

  public async test(
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
  ): Promise<'success' | 'failure'> {
    const res = await fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/webhooks/test`, {
      method: 'POST',
      headers: http.buildHeaders(false),
    });
    if (res.status === 401 || res.status === 403) onAuthError(res);
    this.testResult = res.ok ? 'success' : 'failure';
    return this.testResult;
  }

  public async fetchLogs(
    storeId: string,
    http: MerchantApiHttpClient,
    onAuthError: (e: unknown) => never,
    invoiceIdFilter?: string,
  ): Promise<WebhookLogDTO[]> {
    const q = invoiceIdFilter ? `?invoiceId=${encodeURIComponent(invoiceIdFilter)}` : '';
    const rows = await http.requestJson<WebhookLogDTO[]>(
      `/api/v1/stores/${encodeURIComponent(storeId)}/webhooks${q}`,
      { headers: http.buildHeaders(false) },
      onAuthError,
    );
    this.logs = rows.slice(0, 100);
    return this.logs;
  }

  public setTestResult(result: 'success' | 'failure'): 'success' | 'failure' {
    this.testResult = result;
    return this.testResult;
  }
}
