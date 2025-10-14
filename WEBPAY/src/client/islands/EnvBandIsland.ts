// EnvBandIsland.ts — slim environment/wallet banner (no node probe)
import { request, connect, isConnected } from '@stacks/connect';

type BannerHydration = {
  env?: string | null;                       // 'dev' | 'staging' | 'prod'
  lastNetwork?: 'mainnet' | 'testnet' | string | null; // from your unsigned payload/network
};

export const EnvBandIsland = (() => {
  function h(): BannerHydration { return (window as any).__PAGE__ || {}; }

  function ensureBand() {
    let el = document.getElementById('env-band');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'env-band';
    el.className = 'env-band'; // styled in CSS below
    el.innerHTML = `
      <span id="env-pill" class="pill"></span>
      <span class="dot">•</span>
      <span id="net-pill" class="pill"></span>
      <span class="dot">•</span>
      <span id="wallet-pill" class="pill"></span>
    `;
    document.body.appendChild(el);
    return el;
  }

  function setTxt(id: string, text: string) {
    const n = document.getElementById(id);
    if (n) n.textContent = text;
  }

  async function refreshWallet() {
    try {
      if (!isConnected()) await connect();
      const acc = await request('stx_getAccounts'); // returns { addresses: [...] }
      const n = Array.isArray((acc as any)?.addresses) ? (acc as any).addresses.length : 0;
      setTxt('wallet-pill', n > 0 ? `wallet: connected (${n})` : 'wallet: connected'); // shape per ref.
    } catch {
      setTxt('wallet-pill', 'wallet: not connected');
    }
  }

  async function init() {
    ensureBand();
    const { env, lastNetwork } = h();
    setTxt('env-pill', `env: ${env || (location.hostname.includes('localhost') ? 'dev' : 'prod')}`);
    setTxt('net-pill', `network: ${lastNetwork || 'unknown'}`);
    refreshWallet();
  }

  document.addEventListener('DOMContentLoaded', init);
  return { init };
})();
