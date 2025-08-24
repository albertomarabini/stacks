// frontend/checkout/delegates/BannerDelegate.ts

export class BannerDelegate {
  show(
    message: string,
    type: 'info' | 'success' | 'error' = 'info',
    selector: string = '#banner',
  ): void {
    const node = document.querySelector(selector) as HTMLElement | null;
    if (!node) return;
    node.textContent = message;
    node.className = 'banner';
    node.classList.add(`banner-${type}`);
    node.removeAttribute('hidden');
  }
}
