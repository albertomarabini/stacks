import { ISessionManager, IBridgeApiClient, IBrandingProfileManager } from '../contracts/interfaces';
import { PosPageQrSection } from '../views/PosPageQrSection';
import { MagicLinkDTO } from '../models/core';

class PosRouteHandler {
  private sessionManager: ISessionManager;
  private bridgeApiClient: IBridgeApiClient;
  private brandingProfileManager: IBrandingProfileManager;

  constructor(deps: {
    sessionManager: ISessionManager;
    bridgeApiClient: IBridgeApiClient;
    brandingProfileManager: IBrandingProfileManager;
  }) {
    this.sessionManager = deps.sessionManager;
    this.bridgeApiClient = deps.bridgeApiClient;
    this.brandingProfileManager = deps.brandingProfileManager;
  }

  /**
   * Express GET handler for /pos/:storeId
   * Renders the POS terminal HTML page for the merchant.
   */
  async renderPosPage(req, res, next) {
    try {
      const storeId = req.params.storeId;
      const branding = await this.brandingProfileManager.fetchBranding(storeId);

      res.send(`
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>POS Terminal - Webpay</title>
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link href="/static/tailwind.css" rel="stylesheet">
</head>
<body class="bg-gray-50 min-h-screen">
  <div class="max-w-md mx-auto my-12 bg-white shadow-lg rounded-lg p-8">
    <div class="flex flex-col items-center mb-5">
      ${branding.logoUrl
        ? `<img class="branding-logoImg h-12 mb-3" src="${branding.logoUrl}" alt="${branding.displayName || 'Merchant'} Logo">`
        : ''
      }
      <h1 class="branding-displayName text-2xl font-bold mb-1">${branding.displayName || 'Merchant POS'}</h1>
      <div class="branding-brandBar w-20 h-1.5 rounded-full mb-4" style="background-color:${branding.brandColor || '#2563eb'};"></div>
      ${(branding.supportEmail || branding.supportUrl) ? `
        <div class="mt-2 text-xs text-gray-500">
          Need help?
          ${branding.supportEmail ? `<span class="branding-supportEmail ml-1">${branding.supportEmail}</span>` : ''}
          ${branding.supportUrl ? `<a class="branding-supportUrl ml-2 underline" href="${branding.supportUrl}" target="_blank">${branding.supportUrl}</a>` : ''}
        </div>
      ` : ''}
    </div>
    <form id="saleForm" class="flex flex-col gap-4">
      <div>
        <label class="block text-sm font-semibold mb-1" for="amountInput">Amount (sats)</label>
        <input id="amountInput" type="number" min="1" step="1" class="w-full px-3 py-2 rounded border focus:ring-blue-500" required autocomplete="off">
      </div>
      <div>
        <label class="block text-sm font-semibold mb-1" for="memoInput">Memo/Note</label>
        <input id="memoInput" type="text" maxlength="64" class="w-full px-3 py-2 rounded border focus:ring-blue-500" autocomplete="off">
      </div>
      <div>
        <label class="block text-sm font-semibold mb-1" for="ttlInput">Expiration (seconds, 120-1800)</label>
        <input id="ttlInput" type="number" min="120" max="1800" value="600" class="w-full px-3 py-2 rounded border focus:ring-blue-500" required autocomplete="off">
      </div>
      <div class="flex flex-row gap-3 mt-4">
        <button id="createButton" type="button" class="flex-1 py-2 px-4 rounded bg-blue-600 text-white font-semibold hover:bg-blue-700 focus:outline-none">Create</button>
        <button id="cancelButton" type="button" class="flex-1 py-2 px-4 rounded bg-gray-300 text-gray-700 font-semibold hover:bg-gray-400 focus:outline-none hidden">Cancel</button>
      </div>
    </form>
    <div id="statusStrip" class="mt-6 text-center text-base font-semibold"></div>
    <div id="errorBanner" class="mt-4 text-center text-sm text-red-600 hidden"></div>
    ${PosPageQrSection.renderQrSection("")}
    <div id="newSaleContainer" class="mt-8 flex justify-center hidden">
      <button id="newSaleButton" type="button" class="py-2 px-4 rounded bg-green-600 text-white font-semibold hover:bg-green-700 focus:outline-none">New Sale</button>
    </div>
  </div>
  <script src="/static/qr/qr.min.js"></script>
  <script>
    let currentInvoiceId = null;
    let invoicePollInterval = null;

    document.getElementById('createButton').onclick = function() {
      handleCreateInvoice();
    };
    document.getElementById('cancelButton').onclick = function() {
      handleCancelInvoice();
    };
    document.getElementById('newSaleButton').onclick = function() {
      resetPosForm();
    };

    function handleCreateInvoice() {
      hideError();
      const amountInput = document.getElementById('amountInput');
      const memoInput = document.getElementById('memoInput');
      const ttlInput = document.getElementById('ttlInput');
      const amount = parseInt(amountInput.value, 10);
      const memo = memoInput.value.trim();
      const ttl = parseInt(ttlInput.value, 10);

      if (!(amount > 0)) {
        showError("Amount must be greater than zero.");
        return;
      }
      if (!(ttl >= 120 && ttl <= 1800)) {
        showError("Expiration must be between 120 and 1800 seconds.");
        return;
      }

      amountInput.disabled = true;
      memoInput.disabled = true;
      ttlInput.disabled = true;
      document.getElementById('createButton').disabled = true;

      fetch('/api/v1/stores/${storeId}/prepare-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount_sats: amount, ttl_seconds: ttl, memo })
      })
      .then(async resp => {
        if (!resp.ok) {
          const err = await resp.json();
          throw err;
        }
        return resp.json();
      })
      .then(function(data) {
        currentInvoiceId = data.invoice.invoiceId;
        showQr(data.magicLink);
        showStatus("Waiting for payment...");
        document.getElementById('cancelButton').style.display = '';
        document.getElementById('cancelButton').disabled = false;
        document.getElementById('createButton').style.display = 'none';
        startInvoicePoll(currentInvoiceId);
      })
      .catch(function(err) {
        showError(err.error || 'Unable to create invoice.');
        resetInputs();
      });
    }

    function handleCancelInvoice() {
      hideError();
      if (!currentInvoiceId) return;
      document.getElementById('cancelButton').disabled = true;
      fetch('/api/v1/stores/${storeId}/invoices/' + encodeURIComponent(currentInvoiceId) + '/cancel/create-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      })
      .then(async resp => {
        if (!resp.ok) {
          const err = await resp.json();
          throw err;
        }
        return resp.json();
      })
      .then(function(result) {
        showStatus("Canceled");
        document.getElementById('cancelButton').disabled = true;
        stopInvoicePoll();
        document.getElementById('newSaleContainer').style.display = '';
      })
      .catch(function(err) {
        showError(err.error || 'Unable to cancel invoice.');
        document.getElementById('cancelButton').disabled = false;
      });
    }

    function startInvoicePoll(invoiceId) {
      stopInvoicePoll();
      invoicePollInterval = setInterval(function() {
        fetch('/i/' + encodeURIComponent(invoiceId))
        .then(resp => {
          if (!resp.ok) return null;
          return resp.json();
        })
        .then(function(invoice) {
          if (!invoice) return;
          if (invoice.status === 'paid') {
            showStatus("Paid ✓");
            stopInvoicePoll();
            document.getElementById('cancelButton').disabled = true;
            document.getElementById('newSaleContainer').style.display = '';
          } else if (invoice.status === 'expired') {
            showStatus("Expired");
            stopInvoicePoll();
            document.getElementById('cancelButton').disabled = true;
            document.getElementById('newSaleContainer').style.display = '';
          } else if (invoice.status === 'canceled') {
            showStatus("Canceled");
            stopInvoicePoll();
            document.getElementById('cancelButton').disabled = true;
            document.getElementById('newSaleContainer').style.display = '';
          }
        });
      }, 1000);
    }

    function stopInvoicePoll() {
      if (invoicePollInterval) clearInterval(invoicePollInterval);
      invoicePollInterval = null;
    }

    function showQr(magicLink) {
      const qrSection = document.getElementById('qrSection');
      qrSection.innerHTML = '<canvas id="invoice-qr-canvas"></canvas>';
      if (window.QRCode) {
        window.QRCode.toCanvas(
          document.getElementById('invoice-qr-canvas'),
          magicLink,
          { width: 192, errorCorrectionLevel: 'M' }
        );
      }
      qrSection.classList.remove('hidden');
    }

    function showStatus(msg) {
      const statusEl = document.getElementById('statusStrip');
      statusEl.textContent = msg;
      statusEl.className = "mt-6 text-center text-base font-semibold";
    }

    function showError(msg) {
      const errorEl = document.getElementById('errorBanner');
      errorEl.textContent = msg;
      errorEl.classList.remove('hidden');
    }

    function hideError() {
      const errorEl = document.getElementById('errorBanner');
      errorEl.textContent = "";
      errorEl.classList.add('hidden');
    }

    function resetInputs() {
      document.getElementById('amountInput').disabled = false;
      document.getElementById('memoInput').disabled = false;
      document.getElementById('ttlInput').disabled = false;
      document.getElementById('createButton').disabled = false;
      document.getElementById('createButton').style.display = '';
    }

    function resetPosForm() {
      stopInvoicePoll();
      currentInvoiceId = null;
      document.getElementById('saleForm').reset();
      resetInputs();
      document.getElementById('cancelButton').style.display = 'none';
      document.getElementById('newSaleContainer').style.display = 'none';
      document.getElementById('qrSection').innerHTML = '';
      showStatus("");
      hideError();
    }
  </script>
</body>
</html>
      `);
    } catch (err) {
      next(err);
    }
  }

  /**
   * Express POST handler for /api/v1/stores/:storeId/prepare-invoice
   * Validates input, calls BridgeApiClient, returns invoice/magicLink/unsignedCall JSON.
   */
  async handlePrepareInvoicePost(req, res, next) {
    try {
      const storeId = req.params.storeId;
      const { amount_sats, ttl_seconds, memo } = req.body;
      if (
        typeof amount_sats !== 'number' ||
        amount_sats <= 0 ||
        typeof ttl_seconds !== 'number' ||
        ttl_seconds < 120 ||
        ttl_seconds > 1800 ||
        typeof memo !== 'string'
      ) {
        res.status(400).json({ error: 'Invalid input' });
        return;
      }
      const dto: MagicLinkDTO = await this.bridgeApiClient.prepareInvoice(storeId, {
        amount_sats,
        ttl_seconds,
        memo
      });
      res.json(dto);
    } catch (err) {
      if (err && typeof err.statusCode === 'number') {
        res.status(err.statusCode).json({ error: err.message || 'Bridge error' });
      } else {
        next(err);
      }
    }
  }

  /**
   * Express POST handler for /api/v1/stores/:storeId/invoices/:invoiceId/cancel/create-tx
   * Calls Bridge for cancel, returns result JSON.
   */
  async handleInvoiceCancelPost(req, res, next) {
    try {
      const storeId = req.params.storeId;
      const invoiceId = req.params.invoiceId;
      const endpoint = `/api/v1/stores/${storeId}/invoices/${invoiceId}/cancel/create-tx`;
      const result = await this.bridgeApiClient['httpRequestHelper'].doRequest(
        'POST',
        this.bridgeApiClient['baseUrl'],
        endpoint,
        {
          apiKey: this.bridgeApiClient['securityEnforcer'].getStoreApiKey(storeId)
        }
      );
      res.json(result);
    } catch (err) {
      if (err && typeof err.statusCode === 'number') {
        res.status(err.statusCode).json({ error: err.message || 'Bridge error' });
      } else {
        next(err);
      }
    }
  }
}

export { PosRouteHandler };
