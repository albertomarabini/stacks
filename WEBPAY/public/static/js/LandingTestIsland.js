var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/client/islands/LandingTestIsland.ts
var require_LandingTestIsland = __commonJS({
  "src/client/islands/LandingTestIsland.ts"() {
    (function() {
      function $(sel) {
        return document.querySelector(sel);
      }
      function onReady(fn) {
        if (document.readyState === "complete" || document.readyState === "interactive") {
          setTimeout(fn, 0);
        } else {
          document.addEventListener("DOMContentLoaded", fn);
        }
      }
      onReady(() => {
        const form = $("#checkout-form");
        const storeIdInput = $("#storeId");
        const formHint = $("#form-hint");
        if (form && storeIdInput) {
          const updateFormHint = () => {
            const sid = (storeIdInput.value || "").trim();
            if (formHint) {
              formHint.innerHTML = `On submit, this form will POST to <code>/checkout/${sid || "&lt;storeId&gt;"}</code> with the fields above.`;
            }
          };
          storeIdInput.addEventListener("input", updateFormHint);
          updateFormHint();
          form.addEventListener("submit", (ev) => {
            const sid = (storeIdInput.value || "").trim();
            if (!sid) {
              ev.preventDefault();
              storeIdInput.focus();
              alert("Please enter a valid Store ID.");
              return;
            }
            form.action = window.__PAGE__.branding.baseURL + `/checkout/${encodeURIComponent(sid)}`;
          });
          form.addEventListener("reset", () => setTimeout(updateFormHint, 0));
        }
        const loginInput = $("#storeIdLogin");
        const loginLink = $("#merchant-login-link");
        const loginHint = $("#merchant-login-hint");
        function updateLoginLink() {
          if (!loginInput || !loginLink) return;
          const sid = (loginInput.value || "").trim();
          const base = window.__PAGE__.branding.baseURL + "/__dev__/login-merchant/";
          const href = base + (sid ? encodeURIComponent(sid) : "");
          loginLink.href = href;
          if (!sid) {
            loginLink.setAttribute("aria-disabled", "true");
            loginLink.style.filter = "grayscale(1)";
            loginLink.style.opacity = "0.6";
            loginLink.style.pointerEvents = "none";
          } else {
            loginLink.removeAttribute("aria-disabled");
            loginLink.style.filter = "";
            loginLink.style.opacity = "";
            loginLink.style.pointerEvents = "";
          }
          if (loginHint) {
            loginHint.innerHTML = `Will GET <code>${href}</code>`;
          }
        }
        if (loginInput && loginLink) {
          loginInput.addEventListener("input", updateLoginLink);
          updateLoginLink();
        }
      });
    })();
  }
});
export default require_LandingTestIsland();
//# sourceMappingURL=LandingTestIsland.js.map
