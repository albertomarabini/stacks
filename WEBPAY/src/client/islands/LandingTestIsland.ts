// LandingTestIsland.ts
(function () {
    function $(sel: string): HTMLElement | null {
      return document.querySelector(sel);
    }

    function onReady(fn: () => void): void {
      if (document.readyState === 'complete' || document.readyState === 'interactive') {
        setTimeout(fn, 0);
      } else {
        document.addEventListener('DOMContentLoaded', fn);
      }
    }

    onReady(() => {
      // ----- Checkout form wiring (/checkout/:storeId)
      const form = $('#checkout-form') as HTMLFormElement | null;
      const storeIdInput = $('#storeId') as HTMLInputElement | null;
      const formHint = $('#form-hint');

      if (form && storeIdInput) {
        const updateFormHint = () => {
          const sid = (storeIdInput.value || '').trim();
          if (formHint) {
            formHint.innerHTML =
              `On submit, this form will POST to <code>/checkout/${sid || '&lt;storeId&gt;'}</code> with the fields above.`;
          }
        };
        storeIdInput.addEventListener('input', updateFormHint);
        updateFormHint();

        form.addEventListener('submit', (ev) => {
          const sid = (storeIdInput.value || '').trim();
          if (!sid) {
            ev.preventDefault();
            storeIdInput.focus();
            alert('Please enter a valid Store ID.');
            return;
          }
          form.action = (window as any).__PAGE__.branding.baseURL + `/checkout/${encodeURIComponent(sid)}`;
        });

        form.addEventListener('reset', () => setTimeout(updateFormHint, 0));
      }

      // ----- Merchant Test Login wiring (__dev__/login-merchant/:storeId)
      const loginInput = $('#storeIdLogin') as HTMLInputElement | null;
      const loginLink = $('#merchant-login-link') as HTMLAnchorElement | null;
      const loginHint = $('#merchant-login-hint');

      function updateLoginLink(): void {
        if (!loginInput || !loginLink) return;
        const sid = (loginInput.value || '').trim();
        const base = (window as any).__PAGE__.branding.baseURL + '/__dev__/login-merchant/';
        const href = base + (sid ? encodeURIComponent(sid) : '');
        loginLink.href = href;

        // aria-disabled visual hint (keeps it a simple GET link)
        if (!sid) {
          loginLink.setAttribute('aria-disabled', 'true');
          loginLink.style.filter = 'grayscale(1)';
          loginLink.style.opacity = '0.6';
          loginLink.style.pointerEvents = 'none';
        } else {
          loginLink.removeAttribute('aria-disabled');
          loginLink.style.filter = '';
          loginLink.style.opacity = '';
          loginLink.style.pointerEvents = '';
        }

        if (loginHint) {
          loginHint.innerHTML = `Will GET <code>${href}</code>`;
        }
      }

      if (loginInput && loginLink) {
        loginInput.addEventListener('input', updateLoginLink);
        updateLoginLink();
      }
    });
  })();
