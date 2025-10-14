var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/client/islands/LedgerRowActionsIsland.ts
var require_LedgerRowActionsIsland = __commonJS({
  "src/client/islands/LedgerRowActionsIsland.ts"() {
    var data = window.__PAGE__ || { kind: "invoices", storeId: "" };
    function readMetaCsrf() {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m?.content || null;
    }
    async function post(url, body = {}) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) qs.append(k, String(v ?? ""));
      const token = data.csrfToken || readMetaCsrf();
      if (token && !qs.get("_csrf")) qs.append("_csrf", token);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: qs.toString(),
        credentials: "same-origin"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      document.querySelector("#invoice-filter-form, #subscription-filter-form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    }
    function $(sel, root = document) {
      return Array.from(root.querySelectorAll(sel));
    }
    function bind() {
      $('[data-row-kind="invoice"]').forEach((row) => {
        const invoiceId = row.getAttribute("data-invoice-id");
        row.querySelector('[data-action="view-invoice"]')?.addEventListener("click", () => {
          window.location.href = `/invoice/${encodeURIComponent(invoiceId)}`;
        });
        row.querySelector('[data-action="cancel-invoice"]')?.addEventListener("click", async () => {
          if (!confirm("Cancel this invoice?")) return;
          await post(`/merchant/${encodeURIComponent(data.storeId)}/invoices/${encodeURIComponent(invoiceId)}/cancel`);
        });
        row.querySelector('[data-action="archive-invoice"]')?.addEventListener("click", async () => {
          if (!confirm("Archive this invoice?")) return;
          await post(`/merchant/${encodeURIComponent(data.storeId)}/invoices/${encodeURIComponent(invoiceId)}/archive`);
        });
        row.querySelector('[data-action="refund-invoice"]')?.addEventListener("click", async () => {
          const amt = prompt("Refund amount (sats):", "0");
          if (!amt) return;
          const memo = prompt("Refund memo (optional):", "") || "";
          await post(`/merchant/${encodeURIComponent(data.storeId)}/invoices/${encodeURIComponent(invoiceId)}/refund`, { amount: amt, memo });
        });
      });
      $('[data-row-kind="subscription"]').forEach((row) => {
        const subId = row.getAttribute("data-subscription-id");
        row.querySelector('[data-action="cancel-subscription"]')?.addEventListener("click", async () => {
          if (!confirm("Cancel this subscription?")) return;
          await post(`/merchant/${encodeURIComponent(data.storeId)}/subscriptions/${encodeURIComponent(subId)}/cancel`);
        });
        row.querySelector('[data-action="invoice-now"]')?.addEventListener("click", async () => {
          const ttl = prompt("Invoice TTL seconds (120..1800):", "900") || "900";
          const memo = prompt("Memo (optional):", "") || "";
          await post(`/merchant/${encodeURIComponent(data.storeId)}/subscriptions/${encodeURIComponent(subId)}/invoice-now`, { ttl, memo });
        });
      });
    }
    bind();
    document.addEventListener("ledger:updated", bind);
  }
});
export default require_LedgerRowActionsIsland();
//# sourceMappingURL=LedgerRowActionsIsland.js.map
