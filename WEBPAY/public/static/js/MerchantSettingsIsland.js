var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/client/islands/MerchantSettingsIsland.ts
var require_MerchantSettingsIsland = __commonJS({
  "src/client/islands/MerchantSettingsIsland.ts"() {
    var data = window.__PAGE__ || {
      kind: "merchant-settings",
      storeId: "",
      saveUrl: "",
      csrfToken: null,
      initial: null
    };
    function toUrlEncoded(obj) {
      const qs = new URLSearchParams();
      for (const [k, v] of Object.entries(obj)) qs.append(k, String(v ?? ""));
      return qs;
    }
    function readMetaCsrf() {
      const m = document.querySelector('meta[name="csrf-token"]');
      return m?.content || null;
    }
    function snapshotFormGeneric(form) {
      const fd = new FormData(form);
      const body = {};
      for (const [k, v] of fd.entries()) body[k] = typeof v === "string" ? v : "";
      return body;
    }
    async function postFormUrlencoded(url, body) {
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
    function fillFormFromInitial() {
      const form = document.getElementById("merchant-settings-form");
      if (!form || !data.initial) return;
      const m = data.initial;
      const pairs = [
        ["display_name", ["display_name", "displayName"]],
        ["logo_url", ["logo_url", "logoUrl"]],
        ["brand_color", ["brand_color", "brandColor"]],
        ["support_email", ["support_email", "supportEmail"]],
        ["support_url", ["support_url", "supportUrl"]],
        ["principal", ["principal"]]
      ];
      for (const [field, keys] of pairs) {
        const el = form.querySelector(`[name="${field}"]`);
        if (!el) continue;
        let v = "";
        for (const k of keys) {
          if (m[k] != null) {
            v = String(m[k]);
            break;
          }
        }
        el.value = v;
      }
    }
    function attachReset() {
      const form = document.getElementById("merchant-settings-form");
      const btn = form?.querySelector("[data-reset]");
      if (!form || !btn) return;
      btn.addEventListener("click", () => {
        form.reset();
        fillFormFromInitial();
      });
    }
    function attachSubmit() {
      const form = document.getElementById("merchant-settings-form");
      if (!form) return;
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        if (!data.saveUrl) return;
        const body = snapshotFormGeneric(form);
        form.classList.add("opacity-60", "pointer-events-none");
        const submitBtn = form.querySelector('button[type="submit"]');
        const original = submitBtn?.textContent || null;
        if (submitBtn) submitBtn.textContent = "Saving\u2026";
        try {
          await postFormUrlencoded(data.saveUrl, body);
          alert("Settings saved.");
        } catch (err) {
          console.warn("Save failed", err);
          alert("Could not save settings.");
        } finally {
          if (submitBtn && original !== null) submitBtn.textContent = original;
          form.classList.remove("opacity-60", "pointer-events-none");
        }
      });
    }
    fillFormFromInitial();
    attachReset();
    attachSubmit();
  }
});
export default require_MerchantSettingsIsland();
//# sourceMappingURL=MerchantSettingsIsland.js.map
