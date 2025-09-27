import { IBridgeApiClient, IErrorHandler } from '../contracts/interfaces';
import { MagicLinkDTO } from '../models/core';
import { Request, Response, NextFunction } from 'express';

class CheckoutHandler {
  private bridgeApiClient: IBridgeApiClient;
  private errorHandler: IErrorHandler;

  constructor(deps: { bridgeApiClient: IBridgeApiClient; errorHandler: IErrorHandler }) {
    this.bridgeApiClient = deps.bridgeApiClient;
    this.errorHandler = deps.errorHandler;
  }

  async handleCheckoutPost(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { storeId } = req.params;
    const { amount_sats, ttl_seconds, memo, orderId, payerPrincipal } = req.body;

    // Validation
    if (
      typeof amount_sats !== 'number' ||
      amount_sats <= 0 ||
      typeof ttl_seconds !== 'number' ||
      ttl_seconds < 120 ||
      ttl_seconds > 1800 ||
      typeof memo !== 'string' ||
      !memo
    ) {
      this.errorHandler.handleValidationError(res, {
        error: 'Invalid input. Required: amount_sats>0, memo (string), ttl_seconds[120,1800]',
      });
      return;
    }
    if (orderId && typeof orderId !== 'string') {
      this.errorHandler.handleValidationError(res, {
        error: 'orderId must be a string if provided.',
      });
      return;
    }
    if (payerPrincipal && typeof payerPrincipal !== 'string') {
      this.errorHandler.handleValidationError(res, {
        error: 'payerPrincipal must be a string if provided.',
      });
      return;
    }

    try {
      const payload: {
        amount_sats: number;
        ttl_seconds: number;
        memo: string;
        orderId?: string;
        payerPrincipal?: string;
      } = { amount_sats, ttl_seconds, memo };
      if (orderId) payload.orderId = orderId;
      if (payerPrincipal) payload.payerPrincipal = payerPrincipal;

      const result: MagicLinkDTO = await this.bridgeApiClient.prepareInvoice(storeId, payload);
      res.redirect(302, result.magicLink);
    } catch (err: any) {
      this.errorHandler.handleBridgeError(res, err);
    }
  }
}

export { CheckoutHandler };
