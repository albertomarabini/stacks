// POSIsland.ts
import { DrawerContentRenderer } from './helpers/DrawerContentRenderer';
import { POSElementBinder } from './helpers/POSElementBinder';
import { QRCodeUtility } from '../../shared/utils/QRCodeUtility';

export const POSIsland = (() => {
  let currentDrawerType: 'invoice' | 'subscription' | null = null;
  let currentDrawerId: string | null = null;

  let countdownIntervalId: number | null = null;
  let countdownDeadlineMs: number | null = null;

  function handleHydration(hydration: { storeId: string;[key: string]: any }): void {
    if (!hydration || typeof hydration.storeId !== 'string' || !hydration.storeId) {
      disablePOSUI('Missing or invalid hydration (storeId required)');
      return;
    }
    enablePOSUI();
    setDefaultMemoOnForm();

    POSElementBinder.bindAllPOSEventHandlers({
      onFormSubmit: handleFormSubmit,
      onNewSaleClick: handleNewSaleClick,
      onCopyLinkClick: handleCopyLinkClick,
      onShowQRClick: handleShowQRClick,
      onDrawerToggle: handleDrawerToggle,
      onInvoiceRowClick: handleInvoiceRowClick,
      onSubscriptionRowClick: handleSubscriptionRowClick,
    });

    // Also wire the in-card "New invoice" button
    const newInvoiceBtn = document.getElementById('new-invoice');
    if (newInvoiceBtn) newInvoiceBtn.addEventListener('click', handleNewSaleClick as any);

    // Terminal status from StatusStrip
    document.addEventListener('invoice:terminal', () => {
      stopCountdown();
      showExpiredQRMessage();
      purgeInvoiceFromPage();
    });

    if ((hydration as any).magicLink) drawQRCode();
  }

  // --- new helper to swap QR with message ---
  function showExpiredQRMessage(): void {
    const qrCanvas = document.getElementById('qr') as HTMLCanvasElement | null;
    if (!qrCanvas) return;
    qrCanvas.style.display = 'none';
    let msg = document.getElementById('qr-expired-msg') as HTMLElement | null;
    if (!msg) {
      msg = document.createElement('div');
      msg.id = 'qr-expired-msg';
      msg.className = 'text-center text-muted';
      msg.textContent = 'Invoice expired, please generate a new one.';
      qrCanvas.parentNode?.appendChild(msg);
    }
    (msg as HTMLElement).style.display = '';
  }

  function removeExpiredQRMessage():void{
    let msg = document.getElementById('qr-expired-msg') as HTMLElement | null;
    if (!msg) return;
    (msg as HTMLElement).style.display = 'none';
  }

  function showCopyFeedback(msg: string): void {
    const el = document.getElementById('copy-feedback');
    if (!el) return; // element exists in the EJS template
    el.textContent = msg;
    (el as HTMLElement).style.display = '';
    window.setTimeout(() => {
      (el as HTMLElement).style.display = 'none';
    }, 1400);
  }

  function handleCopyLinkClick(event: MouseEvent): void {
    event.preventDefault();
    const magicLink = (window as any).__PAGE__?.origLink;
    if (!magicLink) return;
    navigator.clipboard.writeText(magicLink).then(() => showCopyFeedback('Link copied!'));
  }

  function handleShowQRClick(event: MouseEvent): void {
    event.preventDefault();
    drawQRCode();
    const qrCanvas = document.getElementById('qr');
    if (qrCanvas) qrCanvas.style.display = '';
  }

  function handleNewSaleClick(event: MouseEvent): void {
    event.preventDefault();
    resetPOSUI();
    purgeInvoiceFromPage();
    removeExpiredQRMessage();
  }

  function handleFormSubmit(form: HTMLFormElement, event: Event): void {
    event.preventDefault();
    const amountInput = form.querySelector('input[name="amount"]') as HTMLInputElement;
    const ttlInput = form.querySelector('input[name="ttl"]') as HTMLInputElement;
    const memoInput = form.querySelector('input[name="memo"]') as HTMLInputElement;
    const storeId = (window as any).__PAGE__?.storeId;

    const amount = amountInput?.value ? Number(amountInput.value) : 0;
    const ttl = ttlInput?.value ? Number(ttlInput.value) : 0;
    const memo = typeof memoInput?.value === 'string' ? memoInput.value : '';

    disablePOSForm('Processing…');

    function getCsrf(): string {
      const el = document.querySelector('meta[name="csrf-token"]');
      return el?.getAttribute('content') || '';
    }

    fetch(`/merchant/stores/${storeId}/prepare-invoice`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-CSRF-Token': getCsrf(),
      },
      credentials: 'same-origin',
      cache: 'no-store',
      body: JSON.stringify({ amount, ttl, memo })
    })
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(dto => {
        if (!dto?.magicLink) {
          showPOSFormError('Failed to create invoice.');
          enablePOSForm();
          return;
        }
        // store fresh refs
        (window as any).__PAGE__.magicLink = dto.magicLink;
        (window as any).__PAGE__.origLink = dto.origLink;
        if (dto.invoiceId) {
          (window as any).__PAGE__.invoiceId = dto.invoiceId;
          document.dispatchEvent(new Event('invoice:ready'));
        }

        // show UI
        removeExpiredQRMessage();
        drawQRCode();
        showPaymentCard(dto);
        // hideNewInvoiceAction(); // ensure hidden for fresh invoice

        // start countdown (server-provided ttl/expiresIn preferred)
        const ttlSeconds: number =
          typeof dto.ttl === 'number' ? dto.ttl :
            typeof dto.expiresIn === 'number' ? dto.expiresIn :
              ttl;
        startCountdown(ttlSeconds);
      })
      .catch(() => {
        showPOSFormError('Network or validation error.');
        enablePOSForm();
      });
  }

  function startCountdown(ttlSeconds: number): void {
    stopCountdown();
    countdownDeadlineMs = Date.now() + Math.max(0, Math.floor(ttlSeconds)) * 1000;
    updateCountdownDom();

    countdownIntervalId = window.setInterval(() => {
      const remaining = (countdownDeadlineMs as number) - Date.now();
      if (remaining <= 0) {
        stopCountdown();
            showExpiredQRMessage();
            purgeInvoiceFromPage();
            return;
          }
          updateCountdownDom();
        }, 1000);
  }

  function stopCountdown(): void {
    if (countdownIntervalId !== null) {
      clearInterval(countdownIntervalId);
      countdownIntervalId = null;
    }
    countdownDeadlineMs = null;
    const el = document.getElementById('expiry-timer');
    if (el) el.textContent = '';
    const wrap = document.getElementById('expiry-wrap');
    if (wrap) (wrap as HTMLElement).style.display = 'none';
  }

  function updateCountdownDom(): void {
    if (!countdownDeadlineMs) return;
    const el = document.getElementById('expiry-timer');
    const wrap = document.getElementById('expiry-wrap');
    if (!el || !wrap) return;
    const ms = Math.max(0, countdownDeadlineMs - Date.now());
    el.textContent = `Expires in ${formatHMS(ms)}`;
    (wrap as HTMLElement).style.display = '';
  }

  function formatHMS(ms: number): string {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const mm = (h > 0 ? String(m).padStart(2, '0') : String(m));
    const hh = String(h);
    const ss = String(s).padStart(2, '0');
    return h > 0 ? `${hh}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function revealNewInvoiceAction(): void {
    const btn = document.getElementById('new-invoice');
    if (btn) (btn as HTMLButtonElement).style.display = '';
  }

  function hideNewInvoiceAction(): void {
    const btn = document.getElementById('new-invoice');
    if (btn) (btn as HTMLButtonElement).style.display = 'none';
  }

  function purgeInvoiceFromPage(): void {
    if ((window as any).__PAGE__) {
      delete (window as any).__PAGE__.invoiceId;
      delete (window as any).__PAGE__.magicLink;
    }
    const qrCanvas = document.getElementById('qr') as HTMLCanvasElement | null;
    if (qrCanvas) {
      const ctx = qrCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
      qrCanvas.style.display = 'none';
    }
    const statusStrip = document.getElementById('status-strip');
    if (statusStrip) statusStrip.textContent = '';
    stopCountdown();
    document.dispatchEvent(new Event('invoice:purged'));
  }

  function handleInvoiceRowClick(event: MouseEvent): void {
    event.preventDefault();
    const row = event.currentTarget as HTMLElement;
    const invoiceId = row?.dataset?.invoiceId;
    currentDrawerType = 'invoice';
    currentDrawerId = invoiceId || null;
    const drawer = document.getElementById('detail-drawer') as HTMLElement;
    DrawerContentRenderer.renderInvoiceContent(
      invoiceId, drawer, (window as any).__PAGE__, closeDrawer
    );
    openDrawer();
  }

  function handleSubscriptionRowClick(event: MouseEvent): void {
    event.preventDefault();
    const row = event.currentTarget as HTMLElement;
    const subscriptionId = row?.dataset?.subscriptionId;
    currentDrawerType = 'subscription';
    currentDrawerId = subscriptionId || null;
    const drawer = document.getElementById('detail-drawer') as HTMLElement;
    DrawerContentRenderer.renderSubscriptionContent(
      subscriptionId, drawer, (window as any).__PAGE__, closeDrawer
    );
    openDrawer();
  }

  function drawQRCode(): void {
    const qrCanvas = document.getElementById('qr') as HTMLCanvasElement;
    const magicLink = (window as any).__PAGE__?.magicLink;
    if (!qrCanvas || !magicLink) return;
    QRCodeUtility.draw(qrCanvas, magicLink);
    qrCanvas.style.display = '';
  }

  function handleDrawerToggle(event: MouseEvent): void {
    event.preventDefault();
    const drawer = document.getElementById('detail-drawer');
    if (!drawer) return;
    if (drawer.classList.contains('open')) {
      closeDrawer();
    } else if (currentDrawerType && currentDrawerId) {
      if (currentDrawerType === 'invoice') {
        DrawerContentRenderer.renderInvoiceContent(
          currentDrawerId, drawer as HTMLElement, (window as any).__PAGE__, closeDrawer
        );
      } else if (currentDrawerType === 'subscription') {
        DrawerContentRenderer.renderSubscriptionContent(
          currentDrawerId, drawer as HTMLElement, (window as any).__PAGE__, closeDrawer
        );
      }
      openDrawer();
    }
  }

  function closeDrawer(): void {
    const drawer = document.getElementById('detail-drawer');
    if (drawer) {
      drawer.classList.remove('open');
      (drawer as HTMLElement).style.display = 'none';
    }
    currentDrawerType = null;
    currentDrawerId = null;
  }

  function openDrawer(): void {
    const drawer = document.getElementById('detail-drawer');
    if (!drawer) return;
    drawer.classList.add('open');
    (drawer as HTMLElement).style.display = '';
  }

  function resetPOSUI(): void {
    hidePaymentCard();
    enablePOSForm();
    clearPOSFormFields();
    hidePOSFormError();
  }

  function enablePOSUI(): void {
    const posRoot = document.getElementById('pos-root');
    posRoot?.removeAttribute('aria-disabled');
    enablePOSForm();
  }

  function disablePOSUI(message: string): void {
    const posRoot = document.getElementById('pos-root');
    posRoot?.setAttribute('aria-disabled', 'true');
    showPOSFormError(message);
    disablePOSForm();
  }

  function disablePOSForm(message?: string): void {
    const form = document.getElementById('new-sale-form') as HTMLFormElement;
    form.querySelectorAll('input,button').forEach((el: any) => (el.disabled = true));
    if (message) showPOSFormError(message);
  }

  function enablePOSForm(): void {
    const form = document.getElementById('new-sale-form') as HTMLFormElement;
    form.querySelectorAll('input,button').forEach((el: any) => (el.disabled = false));
    hidePOSFormError();
  }

  function clearPOSFormFields(): void {
    const form = document.getElementById('new-sale-form') as HTMLFormElement;
    form.reset();
    const amount = form.querySelector('input[name="amount"]') as HTMLInputElement;
    const ttl = form.querySelector('input[name="ttl"]') as HTMLInputElement;
    const memo = form.querySelector('input[name="memo"]') as HTMLInputElement;
    if (memo) memo.value = buildDefaultMemo();
    const hydration = (window as any).__PAGE__;
    if (typeof hydration.defaultAmountSats === 'number') amount.value = String(hydration.defaultAmountSats);
    if (typeof hydration.defaultTtlSeconds === 'number') ttl.value = String(hydration.defaultTtlSeconds);
  }


  // --- default memo helpers ---
  function setDefaultMemoOnForm(): void {
    const form = document.getElementById('new-sale-form') as HTMLFormElement | null;
    if (!form) return;
    const memo = form.querySelector('input[name="memo"]') as HTMLInputElement | null;
    if (memo && !memo.value) memo.value = buildDefaultMemo();
  }

  function buildDefaultMemo(): string {
    const form = document.getElementById('new-sale-form') as HTMLFormElement | null;
    const brandingNameCnt = (form)?(form.querySelector('input[name="displayNameField"]') as HTMLInputElement | null):null;
    const brandingName = (brandingNameCnt)?brandingNameCnt.value:'Merchant';
    const now = new Date();
    // YYYY-MM-DD and HH:MM (local)
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const dd = String(now.getDate()).padStart(2, '0');
    const HH = String(now.getHours()).padStart(2, '0');
    const MM = String(now.getMinutes()).padStart(2, '0');
    let msg = `${brandingName} ${yyyy}${mm}${dd}-${HH}:${MM}`;
    return msg.slice(0, 34);
  }

  function showPaymentCard(_dto: any): void {
    const paymentCard = document.getElementById('payment-card');
    if (paymentCard) (paymentCard as HTMLElement).style.display = '';
    const form = document.getElementById('new-sale-form');
    if (form) (form as HTMLElement).style.display = 'none';
  }

  function hidePaymentCard(): void {
    const paymentCard = document.getElementById('payment-card');
    if (paymentCard) (paymentCard as HTMLElement).style.display = 'none';
    const form = document.getElementById('new-sale-form');
    if (form) (form as HTMLElement).style.display = '';
  }

  function showPOSFormError(msg: string): void {
    let err = document.getElementById('pos-form-error');
    if (!err) {
      err = document.createElement('div');
      err.id = 'pos-form-error';
      err.className = 'form-error';
      const form = document.getElementById('new-sale-form');
      if (form?.parentNode) form.parentNode.insertBefore(err, form);
    }
    err.textContent = msg;
    (err as HTMLElement).style.display = '';
  }

  function hidePOSFormError(): void {
    const err = document.getElementById('pos-form-error');
    if (err) (err as HTMLElement).style.display = 'none';
  }

  document.addEventListener('DOMContentLoaded', () => {
    handleHydration((window as any).__PAGE__);
  });

  return {
    handleHydration,
    handleCopyLinkClick,
    handleShowQRClick,
    handleNewSaleClick,
    handleInvoiceRowClick,
    handleSubscriptionRowClick,
    drawQRCode,
    handleDrawerToggle,
  };
})();
