var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/client/islands/InvoiceLedgerIsland.ts
var require_InvoiceLedgerIsland = __commonJS({
  "src/client/islands/InvoiceLedgerIsland.ts"() {
    var data = window.__PAGE__ || {
      kind: "invoices",
      storeId: "",
      filterUrl: "",
      actionsBase: "",
      csrfToken: null
    };
    function readMetaCsrf() {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m?.content || null;
    }
    function $(sel, root = document) {
      return Array.from(root.querySelectorAll(sel));
    }
    function esc(s) {
      return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    }
    async function getJson(url) {
      const res = await fetch(url, { headers: { "Accept": "application/json" }, credentials: "same-origin" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    }
    function renderInvoiceDialog(model) {
      const body = document.getElementById("invoice-dialog-body");
      if (!body) return;
      body.innerHTML = `
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
        <dt class="text-muted">Invoice</dt><dd class="font-mono">${esc(model.id || model.invoiceId || model.idRaw)}</dd>
        <dt class="text-muted">Status</dt><dd><span class="badge">${esc(model.status)}</span></dd>
        <dt class="text-muted">Amount</dt><dd>${esc(model.amountSats)} sats</dd>
        <dt class="text-muted">Memo</dt><dd>${esc(model.memo || "")}</dd>
        <dt class="text-muted">Created</dt><dd>${esc(model.createdAt || "")}</dd>
        <dt class="text-muted">Payer</dt><dd>${esc(model.payer || model.payerPrincipal || "")}</dd>
      </dl>
    `;
    }
    async function openInvoice(invoiceId) {
      const dlg = document.getElementById("invoice-dialog");
      try {
        dlg?.showModal();
        const json = await getJson(`/status/${encodeURIComponent(data.storeId)}/${encodeURIComponent(invoiceId)}`);
        renderInvoiceDialog(json);
      } catch (err) {
        console.warn("load invoice failed", err);
        alert("Could not load invoice details.");
        dlg?.close();
      }
    }
    function toUrlEncoded(body) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) qs.append(k, String(v ?? ""));
      return qs;
    }
    async function postHtml(url, body) {
      const token = data.csrfToken || readMetaCsrf();
      const qs = toUrlEncoded(body);
      if (token && !qs.get("_csrf")) qs.append("_csrf", token);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "text/html",
          "X-Requested-With": "XMLHttpRequest",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: qs.toString(),
        credentials: "same-origin"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }
    async function postAction(url, body = {}) {
      const token = data.csrfToken || readMetaCsrf();
      const qs = toUrlEncoded(body);
      if (token && !qs.get("_csrf")) qs.append("_csrf", token);
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8" },
        body: qs.toString(),
        credentials: "same-origin"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    }
    function attachFilter() {
      const form = document.getElementById("invoice-filter-form");
      const target = document.getElementById("ledger-results");
      if (!form || !target) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await refreshLedgerFromForm();
        } catch (err) {
          console.warn("filter failed", err);
        }
      });
    }
    async function refreshLedgerFromForm() {
      const form = document.getElementById("invoice-filter-form");
      const target = document.getElementById("ledger-results");
      if (!form || !target) return;
      const fd = new FormData(form);
      const status = String(fd.get("status") || "");
      target.classList.add("opacity-60", "pointer-events-none");
      try {
        const html = await postHtml(data.filterUrl, { status });
        const doc = new DOMParser().parseFromString(html, "text/html");
        const fresh = doc.getElementById("ledger-results");
        target.innerHTML = fresh ? fresh.innerHTML : html;
        bindRowActions();
      } finally {
        target.classList.remove("opacity-60", "pointer-events-none");
      }
    }
    function bindRowActions() {
      $('[data-row-kind="invoice"]').forEach((row) => {
        const invoiceId = row.getAttribute("data-invoice-id");
        row.querySelector('[data-action="view-invoice"]')?.addEventListener("click", () => {
          openInvoice(invoiceId);
        });
        row.querySelector('[data-action="cancel-invoice"]')?.addEventListener("click", async () => {
          if (!confirm("Cancel this invoice?")) return;
          await postAction(`${data.actionsBase}/${encodeURIComponent(invoiceId)}/cancel`);
          await refreshLedgerFromForm();
        });
        row.querySelector('[data-action="refund-invoice"]')?.addEventListener("click", async () => {
          const amt = prompt("Refund amount (sats):", "0");
          if (!amt) return;
          const memo = prompt("Refund memo (optional):", "") || "";
          await postAction(`${data.actionsBase}/${encodeURIComponent(invoiceId)}/refund`, { amount: amt, memo });
          await refreshLedgerFromForm();
        });
      });
    }
    attachFilter();
    bindRowActions();
    document.querySelector("#invoice-dialog [data-close]")?.addEventListener("click", () => {
      document.getElementById("invoice-dialog")?.close();
    });
  }
});
export default require_InvoiceLedgerIsland();
//# sourceMappingURL=InvoiceLedgerIsland.js.map
