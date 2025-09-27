class SubscriptionModalFormStateDelegate {
  openModal(): void {
    const modal = document.getElementById('createSubscriptionModal');
    modal.classList.remove('hidden');
    (document.getElementById('subscription-subscriberPrincipal') as HTMLInputElement).value = '';
    (document.getElementById('subscription-amountSats') as HTMLInputElement).value = '';
    (document.getElementById('subscription-intervalBlocks') as HTMLInputElement).value = '';
    this.setError('');
    const principalInput = document.getElementById('subscription-subscriberPrincipal') as HTMLInputElement;
    principalInput.focus();
  }

  getFormValues(): { subscriberPrincipal: string; amountSats: number; intervalBlocks: number } {
    const subscriberPrincipal = (document.getElementById('subscription-subscriberPrincipal') as HTMLInputElement).value.trim();
    const amountSats = Number((document.getElementById('subscription-amountSats') as HTMLInputElement).value);
    const intervalBlocks = Number((document.getElementById('subscription-intervalBlocks') as HTMLInputElement).value);
    return { subscriberPrincipal, amountSats, intervalBlocks };
  }

  validateForm(): { valid: boolean; errorMessage: string } {
    const principalInput = document.getElementById('subscription-subscriberPrincipal') as HTMLInputElement;
    const amountInput = document.getElementById('subscription-amountSats') as HTMLInputElement;
    const intervalInput = document.getElementById('subscription-intervalBlocks') as HTMLInputElement;
    const subscriberPrincipal = principalInput.value.trim();
    const amountSats = Number(amountInput.value);
    const intervalBlocks = Number(intervalInput.value);
    const principalRegex = /^S[A-Za-z0-9]{38,}$/;
    if (!subscriberPrincipal || !principalRegex.test(subscriberPrincipal)) {
      return { valid: false, errorMessage: 'Invalid subscriber principal.' };
    }
    if (!amountSats || amountSats <= 0) {
      return { valid: false, errorMessage: 'Amount must be greater than zero.' };
    }
    if (!intervalBlocks || intervalBlocks <= 0) {
      return { valid: false, errorMessage: 'Interval must be greater than zero.' };
    }
    return { valid: true, errorMessage: '' };
  }

  setError(message: string): void {
    const errorBanner = document.getElementById('subscriptionModalError');
    if (message) {
      errorBanner.textContent = message;
      errorBanner.classList.remove('hidden');
    } else {
      errorBanner.textContent = '';
      errorBanner.classList.add('hidden');
    }
  }

  reset(): void {
    (document.getElementById('subscription-subscriberPrincipal') as HTMLInputElement).value = '';
    (document.getElementById('subscription-amountSats') as HTMLInputElement).value = '';
    (document.getElementById('subscription-intervalBlocks') as HTMLInputElement).value = '';
    this.setError('');
  }
}

export { SubscriptionModalFormStateDelegate };
