export type BannerFn = (message: string, type?: 'info' | 'success' | 'error') => void;

export class WalletContractCallDelegate {
  getProvider(): (Window & typeof globalThis)['StacksProvider'] | null {
    return (window as any).StacksProvider || null;
  }

  async openUnsignedContractCall(
    payload: Record<string, any>,
    onFinish: (tx?: unknown) => void,
    onCancel: () => void
  ): Promise<void> {
    const openContractCall = (window as any).openContractCall;
    await openContractCall({ ...payload, onFinish, onCancel });
  }

  onFinish(notify: BannerFn, afterFinish: () => void, _tx?: unknown): void {
    notify('Payment submitted', 'success');
    afterFinish();
  }

  onCancel(notify: BannerFn): void {
    notify('User rejected transaction', 'info');
  }

  disableOpenWallet(selector = '#openWallet'): void {
    const btn = document.querySelector(selector) as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
  }
}
