var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/client/islands/SubscriptionLedgerIsland.ts
var require_SubscriptionLedgerIsland = __commonJS({
  "src/client/islands/SubscriptionLedgerIsland.ts"() {
    var data = window.__PAGE__ || {
      kind: "subscriptions",
      storeId: "",
      filterUrl: "",
      actionsBase: "",
      csrfToken: null
    };
    function $(sel, root = document) {
      return Array.from(root.querySelectorAll(sel));
    }
    var esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    function toUrlEncoded(body) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(body)) qs.append(k, String(v ?? ""));
      return qs;
    }
    function readMetaCsrf() {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m?.content || null;
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
    async function postJson(url, body) {
      const token = data.csrfToken || readMetaCsrf();
      const obj = { ...body };
      if (token && !("_csrf" in obj)) obj._csrf = token;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Accept": "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(obj),
        credentials: "same-origin"
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
      }
      if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { body: json || text });
      return json;
    }
    async function refreshLedgerFromForm() {
      const form = document.getElementById("subscription-filter-form");
      const target = document.getElementById("subs-ledger-results");
      if (!form || !target) return;
      const fd = new FormData(form);
      const status = String(fd.get("status") || "");
      const next_due = String(fd.get("next_due") || "");
      const q = String(fd.get("q") || "");
      target.classList.add("opacity-60", "pointer-events-none");
      try {
        const html = await postHtml(data.filterUrl, { status, next_due, q });
        const doc = new DOMParser().parseFromString(html, "text/html");
        const fresh = doc.getElementById("subs-ledger-results");
        target.innerHTML = fresh ? fresh.innerHTML : html;
        bindRowActions();
      } finally {
        target.classList.remove("opacity-60", "pointer-events-none");
      }
    }
    function attachFilter() {
      const form = document.getElementById("subscription-filter-form");
      if (!form) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          await refreshLedgerFromForm();
        } catch (err) {
          console.warn("filter failed", err);
        }
      });
    }
    function renderSuccessSheet(model) {
      const dlg = document.getElementById("sub-success-dialog");
      const body = document.getElementById("sub-success-body");
      if (!dlg || !body) return;
      const invoice = model?.invoice || {};
      const magicLink = model?.magicLink || "";
      const exp = invoice?.quoteExpiresAt || "";
      const amt = invoice?.amountSats ?? "";
      body.innerHTML = `
      <dl class="grid grid-cols-2 gap-x-4 gap-y-2">
        <dt class="text-muted">Invoice</dt><dd class="font-mono">${esc(invoice.invoiceId || "")}</dd>
        <dt class="text-muted">Amount</dt><dd>${esc(amt)} sats</dd>
        <dt class="text-muted">Expires</dt><dd>${esc(exp)}</dd>
        <dt class="text-muted">Magic Link</dt><dd class="truncate font-mono">${esc(magicLink)}</dd>
      </dl>
    `;
      dlg.showModal();
      const copyBtn = dlg.querySelector("[data-copy-link]");
      copyBtn?.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(String(magicLink || ""));
          copyBtn.textContent = "Copied";
          setTimeout(() => copyBtn.textContent = "Copy Link", 1200);
        } catch {
        }
      }, { once: true });
      const mailBtn = dlg.querySelector("[data-send-email]");
      mailBtn?.addEventListener("click", async () => {
        try {
          await postJson(`${data.actionsBase}/${encodeURIComponent(invoice.subscriptionId || model.subscriptionId || "")}/email`, { magicLink });
          mailBtn.textContent = "Sent";
          setTimeout(() => mailBtn.textContent = "Send Email", 1200);
        } catch (e) {
          alert("Email failed");
        }
      }, { once: true });
      dlg.querySelector("[data-close]")?.addEventListener("click", () => dlg.close(), { once: true });
    }
    function bindRowActions() {
      $('[data-row-kind="subscription"]').forEach((row) => {
        const subId = row.getAttribute("data-subscription-id");
        row.querySelector('[data-action="generate-invoice"]')?.addEventListener("click", async () => {
          const ttl = prompt("TTL seconds (120..1800):", "900");
          if (!ttl) return;
          const memo = prompt("Invoice memo (optional):", "") || "";
          try {
            const json = await postJson(`${data.actionsBase}/${encodeURIComponent(subId)}/invoice`, {
              ttl_seconds: ttl,
              memo
            });
            renderSuccessSheet(json);
            await refreshLedgerFromForm();
          } catch (e) {
            console.warn("generate-invoice failed", e);
            alert("Could not create invoice for this subscription.");
          }
        });
        row.querySelector('[data-action="send-email"]')?.addEventListener("click", async () => {
          try {
            await postJson(`${data.actionsBase}/${encodeURIComponent(subId)}/email`, {});
            alert("Email queued");
          } catch (e) {
            alert("Email failed");
          }
        });
        row.querySelector('[data-action="cancel-subscription"]')?.addEventListener("click", async () => {
          if (!confirm("Cancel this subscription?")) return;
          try {
            const res = await postJson(`${data.actionsBase}/${encodeURIComponent(subId)}/cancel`, {});
            if (res && res.unsignedCall) {
              alert("Unsigned cancel returned. Please sign in wallet (integration hook not wired in this island).");
            }
            await refreshLedgerFromForm();
          } catch (e) {
            alert("Cancel failed");
          }
        });
        row.querySelector('[data-action="view-details"]')?.addEventListener("click", () => {
          const evt = new CustomEvent("subscription:details", { detail: { subscriptionId: subId } });
          window.dispatchEvent(evt);
        });
      });
    }
    attachFilter();
    bindRowActions();
    document.querySelector("#sub-success-dialog [data-close]")?.addEventListener("click", () => {
      document.getElementById("sub-success-dialog")?.close();
    });
  }
});
export default require_SubscriptionLedgerIsland();
//# sourceMappingURL=SubscriptionLedgerIsland.js.map
