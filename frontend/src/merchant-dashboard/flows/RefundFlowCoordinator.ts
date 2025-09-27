import { PublicInvoiceDTO, UnsignedContractCall } from '/src/contracts/domain';

export type RefundDialogState = {
  open: boolean;
  invoice?: PublicInvoiceDTO;
  amountSats?: number;
  memo?: string;
  error?: string | null;
  submitting: boolean;
  pending: boolean;
};

export class RefundFlowCoordinator {
  public openDialog(invoice: PublicInvoiceDTO): RefundDialogState {
    return {
      open: true,
      invoice,
      amountSats: undefined,
      memo: undefined,
      error: null,
      submitting: false,
      pending: false,
    };
  }

  public closeDialog(): RefundDialogState {
    return { open: false, submitting: false, pending: false };
  }

  public async submit(
    formEl: HTMLFormElement,
    dialog: RefundDialogState,
    storeId: string,
    http: {
      requestJson<T>(url: string, init: RequestInit & { expectJson?: boolean }, onAuthError: (e: unknown) => never): Promise<T>;
      buildHeaders(hasJson: boolean, overrideApiKey?: string): HeadersInit;
    },
    onAuthError: (e: unknown) => never,
    toSnake: (v: any) => any,
  ): Promise<{ newState: RefundDialogState; unsignedCall?: UnsignedContractCall }> {
    if (!dialog.invoice) throw new Error('No invoice selected for refund.');
    const fd = new FormData(formEl);
    const amountSats = parseInt(String(fd.get('amountSats') ?? '0'), 10);
    const memo = fd.get('memo') ? String(fd.get('memo')) : undefined;

    const refunded = dialog.invoice.refundAmount ?? 0;
    const cap = dialog.invoice.amountSats - refunded;

    if (!Number.isInteger(amountSats) || amountSats <= 0) {
      return { newState: { ...dialog, error: 'Amount must be > 0.' } };
    }
    if (amountSats > cap) {
      return { newState: { ...dialog, error: `Amount exceeds refundable cap (${cap}).` } };
    }
    if (memo) {
      const bytes = new TextEncoder().encode(memo);
      if (bytes.length > 34) {
        return { newState: { ...dialog, error: 'Memo must be ≤ 34 bytes.' } };
      }
    }

    const body = toSnake({ invoiceId: dialog.invoice.invoiceId, amountSats, memo });

    const res = await fetch(`/api/v1/stores/${encodeURIComponent(storeId)}/refunds`, {
      method: 'POST',
      headers: http.buildHeaders(true),
      body: JSON.stringify(body),
    });

    if (res.status === 401 || res.status === 403) onAuthError(res);

    let json: any = {};
    try {
      json = await res.json();
    } catch {}

    if (json?.error === 'insufficient_balance') {
      return { newState: { ...dialog, error: 'Insufficient merchant sBTC balance.' } };
    }

    const unsignedCall = json as UnsignedContractCall;
    const newState: RefundDialogState = { ...dialog, submitting: true, error: null };
    return { newState, unsignedCall };
  }

  public invokeWallet(
    payload: UnsignedContractCall,
    handlers: { onFinish: (tx?: unknown) => void; onCancel: () => void },
  ): void {
    const anyWin = window as any;
    if (!anyWin || typeof anyWin.openContractCall !== 'function') {
      throw new Error('openContractCall is not available on window.');
    }
    anyWin.openContractCall({
      ...payload,
      onFinish: handlers.onFinish,
      onCancel: handlers.onCancel,
    });
  }

  public onFinish(dialog: RefundDialogState): { newState: RefundDialogState; shouldRefetch: boolean } {
    return { newState: { ...dialog, pending: true }, shouldRefetch: true };
  }

  public onCancel(dialog: RefundDialogState): RefundDialogState {
    return { ...dialog, submitting: false };
  }
}
