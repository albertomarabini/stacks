// MagicLinkIsland.ts — public checkout island (server-bridged)
// Paradigm: Server builds unsigned payload, UI calls @stacks/connect request()
// Requests: snake_case ; Responses: camelCase
import type { PostCondition } from '@stacks/transactions';
import { Pc } from '@stacks/transactions';
import { request, connect, isConnected, disconnect } from '@stacks/connect';
import { Cl } from '@stacks/transactions';
import { QRCodeRenderer } from './helpers/QRCodeRenderer';
const MOBILE_APPROVED: string[] = ['xverse', 'LeatherProvider'];

type Hydration = {
  invoiceId: string;
  magicLink: string;                // the URL itself (for copy/QR)
  returnUrl?: string | null;        // optional deep link for merchants
  quoteExpiresAt?: string | number; // ISO string or epoch ms
  memo: string;
};

type UnsignedContractCall = {
  contractAddress: string;
  contractName: string;
  functionName: string;
  functionArgs: any[];              // MUST be Clarity values (Cl.*)
  postConditions?: any[];
  post_conditions?: any[];          // backend may send either; we pass through
  network?: 'mainnet' | 'testnet' | string;
};

type FtPc = {
  type: 'ft-postcondition';
  address: string; // principal whose balance change is checked (usually the caller)
  condition: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  amount: string | number | bigint;
  asset: string;  // "ADDR.contract::asset"
};

type StxPc = {
  type: 'stx-postcondition';
  address: string;
  condition: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
  amount: string | number | bigint;
};

type AnyPc = FtPc | StxPc;

export const MagicLinkIsland = (() => {
  let walletOpenInProgress = false;
  let countdownInterval: number | null = null;

  // NEW: guard to avoid duplicate returnUrl posts
  let postedBack = false;

  function getHydration(): Hydration {
    return (window as any).__PAGE__ as Hydration;
  }

  // ---------- UI helpers ----------
  function show(elId: string, block = false) {
    const el = document.getElementById(elId);
    if (el) {
      el.style.display = block ? 'block' : '';
      el.classList.remove('hidden');
    }
  }
  function hide(elId: string) {
    const el = document.getElementById(elId);
    if (el) {
      el.style.display = 'none';
      el.classList.add('hidden');
    }
  }

  function setError(message: string) {
    const box = document.getElementById('magiclink-error');
    if (box) {
      box.textContent = message;
      show('magiclink-error');
    }
    const btn = document.getElementById('open-wallet') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
    console.error('[PAY][ERR]', message);
  }
  function clearError() {
    hide('magiclink-error');
  }

  function enableWalletBtn() {
    const btn = document.getElementById('open-wallet') as HTMLButtonElement | null;
    if (btn) {
      btn.disabled = false;
      show('open-wallet');
    }
  }
  function disableWalletBtn() {
    const btn = document.getElementById('open-wallet') as HTMLButtonElement | null;
    if (btn) btn.disabled = true;
  }

  // NEW: coarse device detection (POC-grade)
  function isLikelyMobile(): boolean {
    const ua = navigator.userAgent || '';
    const touch = (navigator as any).maxTouchPoints >= 1;
    const handsetHint = /Android|iPhone|iPad|iPod|Mobile|Silk|Kindle|BlackBerry|Opera Mini|IEMobile/i.test(ua);
    const narrow = Math.min(window.innerWidth, window.innerHeight) < 820;
    return handsetHint || (touch && narrow);
  }

  // ---------- Countdown ----------
  function startCountdown(expiryTsMs: number) {
    clearCountdown();
    const el = document.getElementById('countdown');
    if (!el) return;

    const tick = () => {
      const secondsLeft = Math.floor((expiryTsMs - Date.now()) / 1000);
      if (secondsLeft > 0) {
        const m = Math.floor(secondsLeft / 60);
        const s = secondsLeft % 60;
        el.textContent = `${m}:${s < 10 ? '0' : ''}${s}`;
        show('countdown');
      } else {
        el.textContent = 'Expired';
        show('countdown');
        clearCountdown();
        setError('This payment link has expired.');
        // If we have a returnUrl, treat expiry as a non-unpaid state and POST back
        postBackIfNeeded('expired');
      }
    };
    tick();
    countdownInterval = window.setInterval(tick, 1000);
  }
  function clearCountdown() {
    if (countdownInterval !== null) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
  }

  // ---------- QR + Copy ----------
  function drawQRCode() {
    const hydration = getHydration();
    const canvas = document.getElementById('qr') as HTMLCanvasElement | null;
    if (canvas) QRCodeRenderer.draw(canvas, hydration.magicLink);
  }
  function handleCopyLinkClick() {
    const hydration = getHydration();
    navigator.clipboard.writeText(hydration.magicLink).then(() => {
      const btn = document.getElementById('copy-link');
      if (!btn) return;
      const prev = btn.textContent || 'Copy Link';
      btn.textContent = 'Copied!';
      setTimeout(() => (btn.textContent = prev), 1200);
    });
  }
  function handleShowQRClick() {
    drawQRCode();
    show('qr', true);
  }

  // ---------- Return URL helpers ----------
  function buildAndSubmitPost(action: string, fields: Record<string, string>) {
    const form = document.createElement('form');
    form.method = 'POST';
    form.action = action;
    form.style.display = 'none';
    Object.entries(fields).forEach(([k, v]) => {
      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = k;
      input.value = v;
      form.appendChild(input);
    });
    document.body.appendChild(form);
    form.submit();
  }

  function postBackIfNeeded(status: string) {
    if (postedBack) return;
    const { returnUrl, invoiceId, memo } = getHydration();
    if (!returnUrl) return;
    if (status && status.toLowerCase() !== 'unpaid') {
      postedBack = true;
      fetch(`/w/return-proxy/${encodeURIComponent((window as any).__PAGE__.storeId)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ returnUrl, status, invoiceId, memo }),
      })
        .then(async (r) => {
          if (!r.ok) throw new Error(`proxy ${r.status}`);
          const data = await r.json();
          if (data?.redirectTo) {
            window.location.href = data.redirectTo; // visible navigation
          }
        })
        .catch(() => {
          console.warn('Return proxy failed');
          // Optional fallback: still navigate with a GET (no POST), CSP-safe.
          const qs = new URLSearchParams({ status, invoiceId, memo }).toString();
          const sep = returnUrl.includes('?') ? '&' : '?';
          window.location.href = `${returnUrl}${sep}${qs}`;
        });
    }
  }

  function handleCancelClick() {
    // Only if returnUrl is present; status=canceled
    postBackIfNeeded('canceled');
  }

  // ---------- Bridge: POST /create-tx ----------
  async function createTx(invoiceId: string): Promise<UnsignedContractCall> {
    const res = await fetch('/create-tx', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ invoice_id: invoiceId }), // snake_case
    });

    if (res.status === 404) throw new Error('Invoice not found.');
    if (res.status === 410) {
      // inform and POST back
      postBackIfNeeded('expired');
      throw new Error('This payment link has expired.');
    }
    if (res.status === 409) {
      // already paid or canceled → let the merchant know
      postBackIfNeeded('closed');
      throw new Error('Invoice is already paid or canceled.');
    }
    if (!res.ok) {
      const msg = (await safeJson(res))?.error || `Server error (${res.status}).`;
      throw new Error(msg);
    }
    return (await res.json()) as UnsignedContractCall;
  }

  async function safeJson(res: Response) {
    try { return await res.json(); } catch { return null; }
  }

  // ---------- PC sanitizer (drop self-contradictory FT guards) ----------
  function sanitizePostConditions(raw: any[] | undefined | null): AnyPc[] {
    const pcs: AnyPc[] = Array.isArray(raw) ? (raw as AnyPc[]) : [];
    if (!pcs.length) return pcs;

    // group by FT (address + asset)
    const groups = new Map<string, AnyPc[]>();
    for (const pc of pcs) {
      if (pc?.type === 'ft-postcondition') {
        const key = `ft|${pc.address}|${pc.asset}`;
        const arr = groups.get(key) || [];
        arr.push(pc);
        groups.set(key, arr);
      }
    }

    const toRemove = new Set<AnyPc>();

    for (const [key, arr] of groups.entries()) {
      const hasSpendGuard = arr.some(
        (pc) =>
          (pc.condition === 'eq' || pc.condition === 'gt' || pc.condition === 'gte') &&
          Number(pc.amount) > 0
      );
      if (!hasSpendGuard) continue;

      // If there is also an lte 0 for the same (address, asset), it contradicts the spend guard. Drop it.
      for (const pc of arr) {
        if (pc.condition === 'lte' && Number(pc.amount) === 0) {
          toRemove.add(pc);
          console.warn('[PAY][PC] Dropping contradictory FT post-condition lte 0 because a spend guard exists for same address+asset', { key, pc });
        }
      }
    }

    const cleaned = pcs.filter((pc) => !toRemove.has(pc));
    if (cleaned.length !== pcs.length) {
      console.log('[PAY][PC] sanitized PCs', { before: pcs, after: cleaned });
    }
    return cleaned;
  }

  function explorerTxUrl(net: string, txid: string) {
    const t = (net === 'mainnet') ? '' : '?chain=testnet';
    return `https://explorer.hiro.so/tx/${txid}${t}`;
  }

  type FtPcIn = {
    type: 'ft-postcondition';
    address: string;
    condition: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
    amount: string | number | bigint;
    asset: string; // "ADDR.contract::asset"
  };
  type StxPcIn = {
    type: 'stx-postcondition';
    address: string;
    condition: 'eq' | 'gt' | 'gte' | 'lt' | 'lte';
    amount: string | number | bigint;
  };
  type PcIn = FtPcIn | StxPcIn;

  // convert our sanitized plain PCs into real PostCondition objects
  function buildPostConditions(raw: PcIn[] | undefined | null): PostCondition[] {
    const list = Array.isArray(raw) ? raw : [];
    const out: PostCondition[] = [];

    const applyCond = (principal: ReturnType<typeof Pc.principal>, cond: PcIn['condition'], amt: bigint) => {
      switch (cond) {
        case 'eq':  return principal.willSendEq(amt);
        case 'gt':  return principal.willSendGt(amt);
        case 'gte': return principal.willSendGte(amt);
        case 'lt':  return principal.willSendLt(amt);
        case 'lte':
        default:    return principal.willSendLte(amt);
      }
    };

    for (const pc of list) {
      try {
        const principal = Pc.principal(pc.address);
        const amt = BigInt(String(pc.amount ?? 0));

        if (pc.type === 'stx-postcondition') {
          out.push(applyCond(principal, pc.condition, amt).ustx());
          continue;
        }

        if (pc.type === 'ft-postcondition') {
          // parse "ADDR.contract::asset"
          const [left, right] = String(pc.asset).split('.', 2);
          const [contractName, assetName] = String(right || '').split('::', 2);
          if (!left || !contractName || !assetName) continue;

          const stage = applyCond(principal, pc.condition, amt);
          out.push(stage.ft(`${left}.${contractName}`, assetName));
        }
      } catch {
        // ignore bad PC
      }
    }
    return out;
  }

  // ---------- Wallet open (SIP-030 via @stacks/connect) ----------
  async function openWallet() {
    if (walletOpenInProgress) return;
    walletOpenInProgress = true;
    clearError();
    disableWalletBtn();

    const { invoiceId } = getHydration();

    // ensure/remember wallet selection (user-triggered here)
    try {
      if (isLikelyMobile()) {
          // 1) Clear any cached extension/provider choice
          await disconnect(); // clears storage + prior selection (uploads say disconnect clears storage)
          // 2) Hide injected providers so Connect cannot route to an extension
          const injectedKeys = [
            'StacksProvider',         // common injected global
            'LeatherProvider',        // Leather’s window handle
            'XverseProvider',         // just in case of future injection
            'XverseProviders'
          ] as const;
          const backup: Record<string, any> = {};
          for (const k of injectedKeys) {
            if (Object.prototype.hasOwnProperty.call(window as any, k)) {
              backup[k] = (window as any)[k];
              try { (window as any)[k] = undefined; } catch {}
            }
          }
          // 3) Run connect now that no injected provider is visible → forces wallet_connect-style mobile handoff
          await connect();
          // 4) Restore any globals after connect to avoid impacting other parts of the page
          for (const k of Object.keys(backup)) {
            try { (window as any)[k] = backup[k]; } catch {}
          }
        } else if (!isConnected()) {
          await connect();
        }
    } catch {
      walletOpenInProgress = false;
      const el = document.getElementById('countdown');
      if (el && el.textContent !== 'Expired') {
        setError('Please install/enable a Stacks wallet.');
      }
      enableWalletBtn();
      return;
    }

    let payload: UnsignedContractCall;
    try {
      payload = await createTx(invoiceId); // ← server builds unsigned details
    } catch (e: any) {
      walletOpenInProgress = false;
      setError(e?.message || 'Unable to prepare payment.');
      enableWalletBtn();
      return;
    }

    try {
      const effectiveNet =
        payload.network === 'mainnet' || payload.network === 'testnet'
          ? payload.network
          : 'testnet';


      const pcsRaw = payload.post_conditions ?? payload.postConditions ?? [];
      const pcsSanitized = sanitizePostConditions(pcsRaw as PcIn[]);
      const pcsBuilt = buildPostConditions(pcsSanitized);

      console.log('[PAY] opening wallet', {
        contract: `${payload.contractAddress}.${payload.contractName}`,
        fn: payload.functionName,
        net: effectiveNet,
        pcsSanitized,
      });

      const response = await request('stx_callContract', {
        contract: `${payload.contractAddress}.${payload.contractName}`,
        functionName: payload.functionName,
        functionArgs: payload.functionArgs,        // already Cl.* values
        postConditions: pcsBuilt,                  // <-- correct type now
        postConditionMode: 'deny',
        network: effectiveNet,                     // 'mainnet' | 'testnet' is fine here
      });


      walletOpenInProgress = false;

      const txid = (response as any)?.txid || (response as any)?.txId || '';
      console.log('[PAY] wallet response', { txid, networkUsed: effectiveNet });

      const txidEl = document.getElementById('txid');
      if (txidEl) {
        txidEl.textContent = txid || '(no txid)';
        if (txid) {
          // if you have a link element with id="tx-link", update it too
          const link = document.getElementById('tx-link') as HTMLAnchorElement | null;
          if (link) {
            link.href = explorerTxUrl(effectiveNet, txid);
            link.textContent = 'View on Explorer';
            link.target = '_blank';
            show('tx-link');
          }
        }
        show('magiclink-confirm');
      }

      // NOTE: do not redirect here; merchant callback will happen via status observer postBackIfNeeded(...)
    } catch (e: any) {
      walletOpenInProgress = false;

      // Try to surface wallet/node errors clearly
      const msg =
        e?.message ||
        e?.reason ||
        (typeof e === 'string' ? e : 'Payment failed, please try again.');
      setError(msg);

      // Helpful extra logging for broadcast issues
      if (e?.result || e?.reason || e?.stack) {
        console.warn('[PAY][broadcast-error]', { reason: e?.reason, result: e?.result, stack: e?.stack });
      }

      enableWalletBtn();
    }
  }

  // ---------- Lifecycle ----------
  function bindButtons() {
    const openBtn = document.getElementById('open-wallet') as HTMLButtonElement | null;
    if (openBtn) {
      openBtn.className = 'btn';  // unify with global .btn
      openBtn.onclick = openWallet;
      enableWalletBtn();
    }

    const copyBtn = document.getElementById('copy-link') as HTMLButtonElement | null;
    if (copyBtn) {
      copyBtn.className = 'btn secondary';
      copyBtn.addEventListener('click', handleCopyLinkClick);
    }

    // Optional "Show QR" button: add handler if present
    const qrBtn = document.getElementById('show-qr') as HTMLButtonElement | null;
    if (qrBtn) {
      qrBtn.className = 'btn secondary';
      qrBtn.addEventListener('click', handleShowQRClick);
    }

    // Conditional Cancel button (only if returnUrl exists)
    const { returnUrl } = getHydration();
    if (returnUrl) {
      let cancelBtn = document.getElementById('cancel-payment') as HTMLButtonElement | null;
      if (!cancelBtn) {
        cancelBtn = document.createElement('button');
        cancelBtn.id = 'cancel-payment';
        cancelBtn.className = 'btn secondary';
        cancelBtn.textContent = 'Cancel';
        const container = openBtn?.parentElement || document.body;
        container.appendChild(cancelBtn);
      }
      cancelBtn.addEventListener('click', handleCancelClick);
    }
  }

  function attachStatusObservers() {
    // 1) Listen to terminal events from StatusStripIsland
    document.addEventListener('invoice:terminal', (ev: any) => {
      const status = ev?.detail?.status;
      if (typeof status === 'string') postBackIfNeeded(status);
    });

    // 2) Also observe #status-strip text for non-terminal transitions (anything not 'unpaid')
    const el = document.getElementById('status-strip');
    if (!el) return;
    const getStatusText = () => (el.textContent || '').trim().toLowerCase();
    const mo = new MutationObserver(() => {
      const t = getStatusText();
      // normalize a bit; you can map here if your DOM shows “Awaiting payment” for unpaid
      if (t && !t.includes('unpaid') && !t.includes('awaiting')) {
        // Use raw text as status fallback
        postBackIfNeeded(t);
      }
    });
    mo.observe(el, { childList: true, subtree: true, characterData: true });
  }

  async function handleDOMContentLoaded() {
    const hydration = getHydration();

    // Start countdown if we have an expiry snapshot
    if (hydration.quoteExpiresAt) {
      const ts = typeof hydration.quoteExpiresAt === 'number'
        ? hydration.quoteExpiresAt
        : new Date(hydration.quoteExpiresAt).getTime();
      if (Number.isFinite(ts)) startCountdown(ts);
    }

    bindButtons();
    attachStatusObservers();

    // CHANGE: never auto-connect/open on mobile (prevents extension suggestion)
    if (isLikelyMobile()) {
      // Mobile → show explicit button; let user tap to trigger wallet
      enableWalletBtn();
      // Optional: you could hide/show QR here based on CSS
      return;
    }
    // Desktop/tablet → keep auto-open behavior
    try {
      if (!isConnected()) await connect();
      openWallet();
    } catch {
      // No provider; leave button enabled with error shown on click
    }
  }

  function handleBeforeUnload() {
    walletOpenInProgress = false;
    clearCountdown();
  }

  document.addEventListener('DOMContentLoaded', handleDOMContentLoaded);
  window.addEventListener('beforeunload', handleBeforeUnload);

  return { openWallet };
})();
