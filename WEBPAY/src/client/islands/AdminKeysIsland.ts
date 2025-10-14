/**
 * AdminKeysIsland
 * Client-side handler for one-time copy/reveal of admin API keys/HMAC secrets in the SSR admin keys view.
 * Binds to the Copy button and clipboard API. Never exposes secrets after the initial reveal.
 */

export function handleCopySecretClick(event: MouseEvent): void {
  const btn = event.currentTarget as HTMLButtonElement;
  // The secret field is SSR-injected and present only on the initial reveal.
  // Convention: id="api-secret" or id="hmac-secret" or .secret-value near the button

  let secretEl: HTMLElement | null =
    document.getElementById('api-secret') ||
    document.getElementById('hmac-secret');

  if (!secretEl && btn.parentElement) {
    secretEl = btn.parentElement.querySelector('.secret-value');
  }

  if (!secretEl) {
    btn.disabled = true;
    btn.style.display = 'none';
    return;
  }

  let secretValue: string;
  if ('value' in secretEl && typeof (secretEl as HTMLInputElement).value === 'string') {
    secretValue = (secretEl as HTMLInputElement).value;
  } else {
    secretValue = secretEl.textContent || '';
  }

  if (
    !secretValue ||
    !secretValue.trim() ||
    /^\*+$/.test(secretValue.trim())
  ) {
    btn.disabled = true;
    btn.style.display = 'none';
    return;
  }

  navigator.clipboard.writeText(secretValue).then(
    () => {
      btn.textContent = 'Copied!';
      setTimeout(() => {
        btn.textContent = 'Copy';
      }, 1200);
    },
    () => {
      btn.textContent = 'Copy failed';
      setTimeout(() => {
        btn.textContent = 'Copy';
      }, 1200);
    }
  );
}
