import { Store } from '../models/core';
import { Request, Response, NextFunction } from 'express';

class ErrorHandler {
  handleValidationError(res: Response, errorDetails: any): void {
    res.status(400).json({ error: errorDetails });
  }

  handleBridgeError(res: Response, bridgeError: any): void {
    const statusCode =
      bridgeError && typeof bridgeError.statusCode === 'number'
        ? bridgeError.statusCode
        : 400;
    const message =
      bridgeError && (bridgeError.error || bridgeError.message)
        ? bridgeError.error || bridgeError.message
        : 'Bridge API Error';
    res.status(statusCode).json({ error: message });
  }

  handleDuplicateStore(res: Response, context: { existingStore: Store }): void {
    res
      .status(409)
      .json({ error: 'Duplicate store', existingStore: context.existingStore });
  }

  handleError(
    err: any,
    req: Request,
    res: Response,
    next: NextFunction
  ): void {
    const statusCode =
      err && typeof err.statusCode === 'number' ? err.statusCode : 500;
    const message =
      err && (err.error || err.message)
        ? err.error || err.message
        : 'Internal server error';
    res.status(statusCode).json({ error: message });
  }

  handleBridgeApiError(error: any): void {
    if (
      typeof window !== 'undefined' &&
      typeof document !== 'undefined'
    ) {
      const msg =
        error && (error.error || error.message)
          ? error.error || error.message
          : 'Error';
      let toast = document.getElementById('merchant-console-toast');
      if (!toast) {
        toast = document.createElement('div');
        toast.id = 'merchant-console-toast';
        toast.className =
          'fixed top-4 right-4 bg-red-600 text-white px-4 py-2 rounded shadow z-50';
        document.body.appendChild(toast);
      }
      toast.textContent = msg;
      toast.style.display = '';
      setTimeout(() => {
        toast.style.display = 'none';
      }, 2500);

      const btns = document.querySelectorAll('[data-disable-on-error]');
      for (let i = 0; i < btns.length; i++) {
        (btns[i] as HTMLButtonElement).disabled = true;
      }

      const banner = document.getElementById('error-banner');
      if (banner) {
        banner.textContent = msg;
        banner.classList.remove('hidden');
      }
    } else {
      throw error;
    }
  }
}

export { ErrorHandler };
