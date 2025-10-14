// StatusStripIsland.ts
import { StatusStripDomRenderer } from './helpers/StatusStripDomRenderer';
import { StatusPollingBackoffManager } from './helpers/StatusPollingBackoffManager';
import { StatusStripStatusMapper } from './helpers/StatusStripStatusMapper';

export class StatusStripIsland {
  private static domRenderer = new StatusStripDomRenderer();
  static backoffManager = new StatusPollingBackoffManager();

  private static hasInvoice(): boolean {
    const h = (window as any).__PAGE__;
    return !!(h && typeof h.invoiceId === 'string' && h.invoiceId.length > 0);
  }

  static pollStatus(): void {
    if (!StatusStripIsland.hasInvoice()) return;
    const { invoiceId, storeId } = (window as any).__PAGE__;
    fetch(`/status/${storeId}/${invoiceId}`, { headers: { Accept: 'application/json' }, cache: 'no-store' })
      .then((response) => {
        StatusStripIsland.handleStatusResponse(response);
        StatusStripIsland.backoffManager.resetDelay();
      })
      .catch((err) => {
        StatusStripIsland.handleStatusError(err);
        StatusStripIsland.backoffManager.backoffAndRetry(
          StatusStripIsland.pollStatus.bind(StatusStripIsland)
        );
      });
  }

  static handleVisibilityChange(): void {
    if (document.hidden) {
      StatusStripIsland.backoffManager.suspend();
      return;
    }
    if (!StatusStripIsland.hasInvoice()) return;
    const currentStatus = StatusStripIsland.domRenderer.getCurrentStatus();
    const isTerminal = StatusStripStatusMapper.isTerminalStatus(currentStatus as string);
    StatusStripIsland.backoffManager.resume(
      StatusStripIsland.pollStatus.bind(StatusStripIsland),
      isTerminal
    );
  }

  static handleBeforeUnload(): void {
    StatusStripIsland.backoffManager.clearPolling();
  }

  static handleStatusResponse(response: Response): void {
    response
      .json()
      .then((dto) => {
        const status: string = dto.status;
        if (status !== StatusStripIsland.domRenderer.getCurrentStatus()) {
          StatusStripIsland.domRenderer.updateStatus(status);
        }
        StatusStripIsland.domRenderer.hideError();

        if (StatusStripStatusMapper.isTerminalStatus(status)) {
          StatusStripIsland.backoffManager.clearPolling();
          document.dispatchEvent(new CustomEvent('invoice:terminal', { detail: { status } }));
        }
      })
      .catch(() => {
        StatusStripIsland.domRenderer.showError('Error parsing payment status. Retrying…');
      });
  }

  static handleStatusError(_error: any): void {
    StatusStripIsland.domRenderer.showError('Error fetching payment status. Retrying…');
    StatusStripIsland.backoffManager.backoffAndRetry(
      StatusStripIsland.pollStatus.bind(StatusStripIsland)
    );
  }

  static handleHydration(hydration: { invoiceId?: string }): void {
    const ok = StatusStripIsland.domRenderer.validateAndInitHydration(hydration as any);
    if (!ok) {
      StatusStripIsland.backoffManager.clearPolling();
      return;
    }
  }
}

document.addEventListener('DOMContentLoaded', () => {
  const hydration = (window as any).__PAGE__;
  StatusStripIsland.handleHydration(hydration);
  if (StatusStripIsland['hasInvoice']()) {
    StatusStripIsland.pollStatus();
    StatusStripIsland.backoffManager.startPolling(
      StatusStripIsland.pollStatus.bind(StatusStripIsland)
    );
  }
});

document.addEventListener('invoice:ready', () => {
  if (!StatusStripIsland['hasInvoice']()) return;
  StatusStripIsland.pollStatus();
  StatusStripIsland.backoffManager.startPolling(
    StatusStripIsland.pollStatus.bind(StatusStripIsland)
  );
});

document.addEventListener('invoice:purged', () => {
  StatusStripIsland.backoffManager.clearPolling();
});

document.addEventListener(
  'visibilitychange',
  StatusStripIsland.handleVisibilityChange.bind(StatusStripIsland)
);
window.addEventListener(
  'beforeunload',
  StatusStripIsland.handleBeforeUnload.bind(StatusStripIsland)
);
