import { WebhookLog } from '../models/core';

class WebhookLogUiRenderer {
  renderWebhookLogTable(
    container: HTMLElement,
    logs: WebhookLog[],
    onRetry: (webhookLogId: string) => void
  ): void {
    container.innerHTML = '';
    for (const log of logs) {
      const row = document.createElement('div');
      row.className = 'flex flex-row items-center border-b py-2';
      row.innerHTML = `
        <div class="w-52">${log.webhookLogId}</div>
        <div class="w-32">${
          log.status === 'delivered'
            ? '<span class="text-green-600">Delivered</span>'
            : log.status === 'failed'
              ? '<span class="text-red-600">Failed</span>'
              : '<span class="text-yellow-600">Pending</span>'
        }</div>
        <div class="w-40 text-xs truncate">${log.deliveredAt || log.failedAt || ''}</div>
        <div class="w-16">${log.attemptCount}</div>
        <div class="w-28">
          <button class="webhook-retry px-2 py-1 bg-blue-400 rounded text-white"
            data-logid="${log.webhookLogId}"
            ${log.status !== 'failed' ? 'disabled' : ''}>Retry</button>
        </div>
        <div class="flex-1 text-xs break-all">${JSON.stringify(log.payload)}</div>
      `;
      container.appendChild(row);
    }
    container.querySelectorAll('.webhook-retry').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tgt = e.currentTarget as HTMLButtonElement;
        const logId = tgt.getAttribute('data-logid')!;
        onRetry(logId);
      });
    });
  }
}

export { WebhookLogUiRenderer };
