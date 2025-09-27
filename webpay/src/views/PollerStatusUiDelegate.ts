import { PollerStatus } from '../models/core';

class PollerStatusUiDelegate {
  renderPollerStatus(container: HTMLElement, data: PollerStatus): void {
    container.innerHTML = `
      <div class="flex flex-col gap-2">
        <div>Running: <span class="${data.running ? 'text-green-600' : 'text-red-600'}">${data.running ? 'Yes' : 'No'}</span></div>
        <div>Last Run At: <span>${data.lastRunAt || ''}</span></div>
        <div>Last Height: <span>${data.lastHeight}</span></div>
        <div>Last TxId: <span>${data.lastTxId || ''}</span></div>
        <div>Lag Blocks: <span>${data.lagBlocks}</span></div>
      </div>
    `;
  }
}

export { PollerStatusUiDelegate };
