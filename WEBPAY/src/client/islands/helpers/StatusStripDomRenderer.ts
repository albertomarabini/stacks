//StatusStripDomRenderer.ts

export class StatusStripDomRenderer {
  private statusStripEl: HTMLElement | null = null;
  private errorBannerEl: HTMLElement | null = null;
  private currentStatus: string | null = null;

  updateStatus(status: string): void {
    const el = this.getStatusStripEl();
    el.textContent = this.statusToDisplay(status);
    el.className =
      "status-strip px-2 py-1 rounded border text-sm font-medium transition-colors duration-200 " +
      this.statusToClasses(status);
    this.currentStatus = status;
    if (this.isTerminalStatus(status)) {
      el.setAttribute('data-terminal', 'true');
    }
  }

  showError(message: string): void {
    const errorEl = this.getErrorBannerEl(true);
    errorEl.textContent = message;
    errorEl.style.display = "block";
  }

  hideError(): void {
    const errorEl = this.getErrorBannerEl(false);
    if (errorEl) {
      errorEl.style.display = "none";
    }
  }

  validateAndInitHydration(h: { invoiceId: string } | undefined): boolean {
    if (!h || typeof h.invoiceId !== "string" || !h.invoiceId) {
      // previously wrote an error to the DOM — remove that side effect
      return false; // be silent
    }
    this.currentStatus = null;
    this.hideError();
    return true;
  }


  getCurrentStatus(): string | null {
    return this.currentStatus;
  }

  private getStatusStripEl(): HTMLElement {
    if (this.statusStripEl) return this.statusStripEl;
    this.statusStripEl = document.getElementById("status-strip") as HTMLElement;
    return this.statusStripEl;
  }

  private getErrorBannerEl(createIfMissing: boolean): HTMLElement {
    if (this.errorBannerEl) return this.errorBannerEl;
    let el = document.getElementById("status-strip-error") as HTMLElement | null;
    if (!el && createIfMissing) {
      const parent = this.getStatusStripEl();
      el = document.createElement("div");
      el.id = "status-strip-error";
      el.className =
        "status-strip-error px-2 py-1 rounded border bg-red-50 text-red-800 border-red-200 mt-2 text-sm font-medium";
      el.style.display = "none";
      if (parent && parent.parentNode) {
        parent.parentNode.insertBefore(el, parent.nextSibling);
      } else {
        document.body.appendChild(el);
      }
    }
    this.errorBannerEl = el as HTMLElement;
    return this.errorBannerEl;
  }

  private statusToDisplay(status: string): string {
    switch (status) {
      case "unpaid":
        return "Awaiting payment";
      case "paid":
        return "Paid ✓";
      case "partially_refunded":
        return "Partially Refunded";
      case "refunded":
        return "Refunded";
      case "canceled":
        return "Canceled";
      case "expired":
        return "Expired";
      default:
        return "Unknown";
    }
  }

  private statusToClasses(status: string): string {
    switch (status) {
      case "unpaid":
        return "bg-yellow-50 text-yellow-800 border-yellow-200";
      case "paid":
        return "bg-green-50 text-green-800 border-green-200";
      case "partially_refunded":
      case "refunded":
        return "bg-blue-50 text-blue-800 border-blue-200";
      case "canceled":
      case "expired":
        return "bg-gray-50 text-gray-800 border-gray-200";
      default:
        return "bg-red-50 text-red-800 border-red-200";
    }
  }

  private isTerminalStatus(status: string): boolean {
    return status === "paid" || status === "expired" || status === "canceled";
  }
}
