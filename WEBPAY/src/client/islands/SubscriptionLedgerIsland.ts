/* eslint-disable no-alert, no-console */

type PageData = {
    kind: 'subscriptions';
    storeId: string;
    filterUrl: string;      // WEBPAY controller (SSR fragment): /merchant/:storeId/subscriptions/filter
    actionsBase: string;    // WEBPAY controller base: /merchant/:storeId/subscriptions
    csrfToken?: string | null;
  };
  const data: PageData = (window as any).__PAGE__ || {
    kind: 'subscriptions',
    storeId: '',
    filterUrl: '',
    actionsBase: '',
    csrfToken: null,
  };

  function $(sel: string, root: Document | HTMLElement = document) {
    return Array.from(root.querySelectorAll(sel)) as HTMLElement[];
  }

  // Tiny esc
  const esc = (s: any) =>
    String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));

  function toUrlEncoded(body: Record<string, any>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(body)) qs.append(k, String(v ?? ''));
    return qs;
  }

  function readMetaCsrf(): string | null {
    const m = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
    return m?.content || null;
  }

  async function postHtml(url: string, body: Record<string, any>) {
    const token = data.csrfToken || readMetaCsrf();
    const qs = toUrlEncoded(body);
    if (token && !qs.get('_csrf')) qs.append('_csrf', token);

    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Accept': 'text/html',
        'X-Requested-With': 'XMLHttpRequest',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      },
      body: qs.toString(),
      credentials: 'same-origin',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.text();
  }

  async function postJson(url: string, body: Record<string, any>) {
    const token = data.csrfToken || readMetaCsrf();
    const obj = { ...body };
    if (token && !('_csrf' in obj)) (obj as any)._csrf = token;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(obj),
      credentials: 'same-origin',
    });
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* leave as text */ }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { body: json || text });
    return json;
  }

  async function refreshLedgerFromForm() {
    const form = document.getElementById('subscription-filter-form') as HTMLFormElement | null;
    const target = document.getElementById('subs-ledger-results');
    if (!form || !target) return;
    const fd = new FormData(form);
    const status = String(fd.get('status') || '');
    const next_due = String(fd.get('next_due') || '');
    const q = String(fd.get('q') || '');
    target.classList.add('opacity-60','pointer-events-none');
    try {
      const html = await postHtml(data.filterUrl, { status, next_due, q });
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const fresh = doc.getElementById('subs-ledger-results');
      target.innerHTML = fresh ? fresh.innerHTML : html;
      bindRowActions();
    } finally {
      target.classList.remove('opacity-60','pointer-events-none');
    }
  }

  function attachFilter() {
    const form = document.getElementById('subscription-filter-form') as HTMLFormElement | null;
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      try { await refreshLedgerFromForm(); } catch (err) { console.warn('filter failed', err); }
    });
  }

  function renderSuccessSheet(model: any) {
    const dlg = document.getElementById('sub-success-dialog') as HTMLDialogElement | null;
    const body = document.getElementById('sub-success-body');
    if (!dlg || !body) return;

    const invoice = model?.invoice || {};
    const magicLink = model?.magicLink || '';
    const exp = invoice?.quoteExpiresAt || '';
    const amt = invoice?.amountSats ?? '';
    body.innerHTML = `
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
        <dt class="text-muted">Invoice</dt><dd class="font-mono">${esc(invoice.invoiceId || '')}</dd>
        <dt class="text-muted">Amount</dt><dd>${esc(amt)} sats</dd>
        <dt class="text-muted">Expires</dt><dd>${esc(exp)}</dd>
        <dt class="text-muted">Magic Link</dt><dd class="truncate font-mono">${esc(magicLink)}</dd>
      </dl>
    `;
    dlg.showModal();

    const copyBtn = dlg.querySelector('[data-copy-link]') as HTMLButtonElement | null;
    copyBtn?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(String(magicLink || '')); copyBtn.textContent = 'Copied'; setTimeout(()=>copyBtn.textContent='Copy Link',1200); } catch {}
    }, { once: true });

    const mailBtn = dlg.querySelector('[data-send-email]') as HTMLButtonElement | null;
    mailBtn?.addEventListener('click', async () => {
      try {
        // NOTE: server route name is app-specific; see “Confidence line”
        await postJson(`${data.actionsBase}/${encodeURIComponent(invoice.subscriptionId || model.subscriptionId || '')}/email`, { magicLink });
        mailBtn.textContent = 'Sent';
        setTimeout(()=>mailBtn.textContent='Send Email',1200);
      } catch (e) {
        alert('Email failed');
      }
    }, { once: true });

    dlg.querySelector('[data-close]')?.addEventListener('click', () => dlg.close(), { once: true });
  }

  function bindRowActions() {
    $('[data-row-kind="subscription"]').forEach((row) => {
      const subId = row.getAttribute('data-subscription-id')!;
      // Generate invoice now
      row.querySelector<HTMLElement>('[data-action="generate-invoice"]')?.addEventListener('click', async () => {
        const ttl = prompt('TTL seconds (120..1800):', '900');
        if (!ttl) return;
        const memo = prompt('Invoice memo (optional):', '') || '';
        try {
          const json = await postJson(`${data.actionsBase}/${encodeURIComponent(subId)}/invoice`, {
            ttl_seconds: ttl, memo
          });
          renderSuccessSheet(json);
          await refreshLedgerFromForm();
        } catch (e) {
          console.warn('generate-invoice failed', e);
          alert('Could not create invoice for this subscription.');
        }
      });

      // Send email (row-level shortcut; uses server to send latest link)
      row.querySelector<HTMLElement>('[data-action="send-email"]')?.addEventListener('click', async () => {
        try {
          await postJson(`${data.actionsBase}/${encodeURIComponent(subId)}/email`, {});
          alert('Email queued');
        } catch (e) {
          alert('Email failed');
        }
      });

      // Cancel subscription (may return unsigned call)
      row.querySelector<HTMLElement>('[data-action="cancel-subscription"]')?.addEventListener('click', async () => {
        if (!confirm('Cancel this subscription?')) return;
        try {
          const res = await postJson(`${data.actionsBase}/${encodeURIComponent(subId)}/cancel`, {});
          // Optional: if server returns { unsignedCall }, open via a shared wallet helper
          if (res && res.unsignedCall) {
            // window.openUnsignedInWallet?.(res.unsignedCall); // hook if available
            alert('Unsigned cancel returned. Please sign in wallet (integration hook not wired in this island).');
          }
          await refreshLedgerFromForm();
        } catch (e) {
          alert('Cancel failed');
        }
      });

      // Details drawer (delegated to your drawer partial / route)
      row.querySelector<HTMLElement>('[data-action="view-details"]')?.addEventListener('click', () => {
        const evt = new CustomEvent('subscription:details', { detail: { subscriptionId: subId } });
        window.dispatchEvent(evt);
      });
    });
  }

  // Boot
  attachFilter();
  bindRowActions();
  document.querySelector('#sub-success-dialog [data-close]')?.addEventListener('click', () => {
    (document.getElementById('sub-success-dialog') as HTMLDialogElement)?.close();
  });
