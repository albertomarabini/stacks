var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/client/islands/LedgerFilterIsland.ts
var require_LedgerFilterIsland = __commonJS({
  "src/client/islands/LedgerFilterIsland.ts"() {
    var data = window.__PAGE__ || {
      kind: "invoices",
      storeId: "",
      filterUrl: "",
      csrfToken: null
    };
    function readMetaCsrf() {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m?.content || null;
    }
    async function postFormAsHtml(url, form) {
      const fd = new FormData(form);
      const qs2 = new URLSearchParams();
      for (const [k, v] of fd) qs2.append(k, String(v ?? ""));
      const token = data.csrfToken || readMetaCsrf();
      if (token && !qs2.get("_csrf")) qs2.append("_csrf", token);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Accept": "text/html",
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8"
        },
        body: qs2.toString(),
        credentials: "same-origin"
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    }
    function attachFilter(formId) {
      const form = document.getElementById(formId);
      const target = document.getElementById("ledger-results");
      if (!form || !target) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        try {
          target.classList.add("opacity-60", "pointer-events-none");
          const html = await postFormAsHtml(data.filterUrl, form);
          target.innerHTML = html;
          document.dispatchEvent(new CustomEvent("ledger:updated"));
        } catch (err) {
          console.warn("filter failed", err);
        } finally {
          target.classList.remove("opacity-60", "pointer-events-none");
        }
      });
    }
    attachFilter(data.kind === "subscriptions" ? "subscription-filter-form" : "invoice-filter-form");
  }
});
export default require_LedgerFilterIsland();
//# sourceMappingURL=LedgerFilterIsland.js.map
