// /frontend/checkout/delegates/PaymentActionsDelegate.ts

export class PaymentActionsDelegate {
  disablePaymentActions(opts?: {
    openWalletSelector?: string;
    qrSelector?: string;
    actionsSelector?: string;
  }): void {
    const openSel = opts?.openWalletSelector ?? '#openWallet';
    const qrSel = opts?.qrSelector ?? '#qrCanvas';
    const actionsSel = opts?.actionsSelector ?? '#actions';

    const btn = document.querySelector(openSel) as HTMLButtonElement;
    btn.disabled = true;

    const qr = document.querySelector(qrSel) as HTMLElement;
    qr.classList.add('disabled');

    const actions = document.querySelector(actionsSel) as HTMLElement;
    actions.setAttribute('hidden', 'true');
  }
}
