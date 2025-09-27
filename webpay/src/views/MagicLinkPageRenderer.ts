import { IMagicLinkPageRenderer, IBrandingProfileManager } from '../contracts/interfaces';
import { QRRenderer } from '../qr/QRRenderer';
import { MagicLinkPageBrandingBlock } from './MagicLinkPageBrandingBlock';
import { MagicLinkU } from '../models/core';

/**
 * Server-side renderer for magic-link checkout and subscription pages.
 * Renders HTML including branding, QR code placeholder, and wallet-ready UI.
 */
class MagicLinkPageRenderer implements IMagicLinkPageRenderer {
  private brandingProfileManager: IBrandingProfileManager;

  constructor(deps: { brandingProfileManager: IBrandingProfileManager }) {
    this.brandingProfileManager = deps.brandingProfileManager;
  }

  /**
   * Renders server-side magic-link payment page.
   * @param req Express request
   * @param res Express response
   * @param validatedUData MagicLinkU (already validated by MagicLinkValidator)
   */
  async renderCheckoutPage(
    req: import('express').Request,
    res: import('express').Response,
    validatedUData: MagicLinkU
  ): Promise<void> {
    const { storeId, invoiceId, subscriptionId, unsignedCall, exp } = validatedUData;
    const nowSecs = Math.floor(Date.now() / 1000);
    const expired = exp < nowSecs;

    // Get branding (live fetch, no cache)
    const branding = await this.brandingProfileManager.fetchBranding(storeId);

    // Branding HTML (static delegate)
    const brandingHtml = MagicLinkPageBrandingBlock.render({
      displayName: branding.displayName || 'Merchant',
      logoUrl: branding.logoUrl || undefined,
      brandColor: branding.brandColor || '#2563eb',
      supportEmail: branding.supportEmail || undefined,
      supportUrl: branding.supportUrl || undefined
    });

    // Amount (sats) from unsignedCall.args[0]
    const amountSats = unsignedCall && Array.isArray(unsignedCall.args) && unsignedCall.args[0]
      ? unsignedCall.args[0]
      : '';

    // Expiry (ISO string)
    const expIso = new Date(exp * 1000).toLocaleString();

    // QR code placeholder (canvas)
    const qrHtml =
      `<div id="qrSection" class="mt-6 flex justify-center"><canvas id="invoice-qr-canvas"></canvas></div>
<script>
if (window.QRCode && document.getElementById('invoice-qr-canvas')) {
  window.QRCode.toCanvas(
    document.getElementById('invoice-qr-canvas'),
    window.location.href,
    { width: 192, errorCorrectionLevel: 'M' }
  );
}
</script>`;

    // State block (expired or ready)
    let stateHtml = '';
    if (expired) {
      stateHtml =
        `<div class="rounded px-2 py-1 font-semibold text-yellow-900 bg-yellow-200 border border-yellow-400 text-center w-full mb-3">
          This payment link has expired.<br>
          <span class="text-xs">Please request a new payment from the merchant.</span>
        </div>`;
    } else {
      stateHtml =
        `<div id="status-strip" class="rounded px-2 py-1 font-semibold text-blue-800 bg-blue-100 border border-blue-400 text-center w-full mb-3">
          Ready to pay
        </div>`;
    }

    // Wallet button (only if not expired)
    let walletButtonHtml = '';
    if (!expired) {
      walletButtonHtml = `<button id="open-wallet-btn" class="mt-6 w-full py-3 rounded bg-blue-600 text-white font-bold text-lg hover:bg-blue-700 focus:outline-none">
        Open wallet
      </button>`;
    }

    // Compose unsignedCall JSON for embedding
    const unsignedCallJson = JSON.stringify(unsignedCall);

    // Compose payment page
    res
      .status(expired ? 410 : 200)
      .send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${branding.displayName || 'Merchant'} Payment - Webpay</title>
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="theme-color" content="${branding.brandColor || '#2563eb'}">
  <link rel="icon" href="${branding.logoUrl || '/static/favicon.ico'}">
  <link href="/static/tailwind.css" rel="stylesheet">
  <meta name="robots" content="noindex">
</head>
<body class="bg-gray-50 min-h-screen flex flex-col items-center justify-center">
  <div class="bg-white shadow-lg rounded-lg w-full max-w-md mx-auto mt-10 p-8 flex flex-col items-center">
    ${brandingHtml}
    ${stateHtml}
    <div class="w-full text-gray-700 mb-2 text-center">
      <span class="font-semibold">Amount:</span>
      <span id="amount" class="ml-1">${amountSats} sats</span>
    </div>
    <div class="w-full text-gray-700 mb-2 text-center">
      <span class="font-semibold">Expires:</span>
      <span id="expiry" class="ml-1">${expIso}</span>
    </div>
    ${qrHtml}
    ${walletButtonHtml}
    <div id="error-banner" class="hidden mt-4 rounded px-2 py-1 font-semibold text-red-800 bg-red-100 border border-red-400 text-center"></div>
    <div id="success-banner" class="hidden mt-4 rounded px-2 py-1 font-semibold text-green-800 bg-green-100 border border-green-400 text-center"></div>
  </div>
  <script>
    // Inject client-side data
    window.magicLinkPageData = {
      storeId: ${JSON.stringify(storeId)},
      invoiceId: ${invoiceId ? JSON.stringify(invoiceId) : 'null'},
      subscriptionId: ${subscriptionId ? JSON.stringify(subscriptionId) : 'null'},
      unsignedCall: ${unsignedCallJson},
      exp: ${exp},
      branding: ${JSON.stringify(branding)},
      magicLinkUrl: window.location.href
    };
    document.addEventListener('DOMContentLoaded', function() {
      var expired = ${expired ? 'true' : 'false'};
      var openWalletBtn = document.getElementById('open-wallet-btn');
      var errorBanner = document.getElementById('error-banner');
      if (expired && openWalletBtn) {
        openWalletBtn.disabled = true;
        openWalletBtn.style.display = 'none';
      }
      if (!expired && openWalletBtn && window.Stacks && window.Stacks.connect) {
        setTimeout(function() {
          openWalletBtn.disabled = true;
          window.Stacks.connect.request('stx_callContract', window.magicLinkPageData.unsignedCall).then(function(result) {
            if (result && result.txid) {
              document.getElementById('success-banner').textContent = 'Payment sent! TxID: ' + result.txid;
              document.getElementById('success-banner').classList.remove('hidden');
            }
          }).catch(function(err) {
            errorBanner.textContent = 'Wallet interaction failed. Please try again.';
            errorBanner.classList.remove('hidden');
            openWalletBtn.disabled = false;
          });
        }, 300);
        openWalletBtn.onclick = function() {
          openWalletBtn.disabled = true;
          window.Stacks.connect.request('stx_callContract', window.magicLinkPageData.unsignedCall).then(function(result) {
            if (result && result.txid) {
              document.getElementById('success-banner').textContent = 'Payment sent! TxID: ' + result.txid;
              document.getElementById('success-banner').classList.remove('hidden');
            }
          }).catch(function(err) {
            errorBanner.textContent = 'Wallet interaction failed. Please try again.';
            errorBanner.classList.remove('hidden');
            openWalletBtn.disabled = false;
          });
        };
      }
    });
  </script>
</body>
</html>`);
  }
}

export { MagicLinkPageRenderer };
