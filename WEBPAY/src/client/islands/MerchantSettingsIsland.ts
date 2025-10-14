/* eslint-disable no-alert, no-console */

type PageData = {
    kind: 'merchant-settings';
    storeId: string;
    saveUrl: string;
    csrfToken?: string | null;
    initial?: Record<string, any> | null;
  };
  const data: PageData = (window as any).__PAGE__ || {
    kind: 'merchant-settings',
    storeId: '',
    saveUrl: '',
    csrfToken: null,
    initial: null,
  };

  function toUrlEncoded(obj: Record<string, any>) {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(obj)) qs.append(k, String(v ?? ''));
    return qs;
  }

  function readMetaCsrf(): string | null {
    const m = document.querySelector('meta[name="csrf-token"]') as HTMLMetaElement | null;
    return m?.content || null;
  }

  function snapshotFormGeneric(form: HTMLFormElement) {
    const fd = new FormData(form);
    const body: Record<string, any> = {};
    for (const [k, v] of fd.entries()) body[k] = typeof v === 'string' ? v : '';
    return body;
  }

  async function postFormUrlencoded(url: string, body: Record<string, any>) {
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

  function fillFormFromInitial() {
    const form = document.getElementById('merchant-settings-form') as HTMLFormElement | null;
    if (!form || !data.initial) return;
    const m = data.initial;

    // prefer snake_case form names; read camelCase fallback from initial
    const pairs: Array<[string, string[]]> = [
      ['display_name', ['display_name','displayName']],
      ['logo_url', ['logo_url','logoUrl']],
      ['brand_color', ['brand_color','brandColor']],
      ['support_email', ['support_email','supportEmail']],
      ['support_url', ['support_url','supportUrl']],
      ['principal', ['principal']],
    ];

    for (const [field, keys] of pairs) {
      const el = form.querySelector(`[name="${field}"]`) as HTMLInputElement | null;
      if (!el) continue;
      let v = '';
      for (const k of keys) { if (m[k] != null) { v = String(m[k]); break; } }
      el.value = v;
    }
  }

  function attachReset() {
    const form = document.getElementById('merchant-settings-form') as HTMLFormElement | null;
    const btn = form?.querySelector('[data-reset]') as HTMLButtonElement | null;
    if (!form || !btn) return;
    btn.addEventListener('click', () => {
      form.reset();
      fillFormFromInitial();
    });
  }

  function attachSubmit() {
    const form = document.getElementById('merchant-settings-form') as HTMLFormElement | null;
    if (!form) return;
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!data.saveUrl) return;

      const body = snapshotFormGeneric(form);

      form.classList.add('opacity-60','pointer-events-none');
      const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
      const original = submitBtn?.textContent || null;
      if (submitBtn) submitBtn.textContent = 'Saving…';

      try {
        await postFormUrlencoded(data.saveUrl, body);
        alert('Settings saved.');
      } catch (err) {
        console.warn('Save failed', err);
        alert('Could not save settings.');
      } finally {
        if (submitBtn && original !== null) submitBtn.textContent = original;
        form.classList.remove('opacity-60','pointer-events-none');
      }
    });
  }

  // boot
  fillFormFromInitial();
  attachReset();
  attachSubmit();
