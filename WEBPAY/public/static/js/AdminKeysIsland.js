// src/client/islands/AdminKeysIsland.ts
function handleCopySecretClick(event) {
  const btn = event.currentTarget;
  let secretEl = document.getElementById("api-secret") || document.getElementById("hmac-secret");
  if (!secretEl && btn.parentElement) {
    secretEl = btn.parentElement.querySelector(".secret-value");
  }
  if (!secretEl) {
    btn.disabled = true;
    btn.style.display = "none";
    return;
  }
  let secretValue;
  if ("value" in secretEl && typeof secretEl.value === "string") {
    secretValue = secretEl.value;
  } else {
    secretValue = secretEl.textContent || "";
  }
  if (!secretValue || !secretValue.trim() || /^\*+$/.test(secretValue.trim())) {
    btn.disabled = true;
    btn.style.display = "none";
    return;
  }
  navigator.clipboard.writeText(secretValue).then(
    () => {
      btn.textContent = "Copied!";
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1200);
    },
    () => {
      btn.textContent = "Copy failed";
      setTimeout(() => {
        btn.textContent = "Copy";
      }, 1200);
    }
  );
}
export {
  handleCopySecretClick
};
//# sourceMappingURL=AdminKeysIsland.js.map
