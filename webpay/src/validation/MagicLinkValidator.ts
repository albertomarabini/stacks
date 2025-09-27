import { IBridgeApiClient } from '../contracts/interfaces';
import { MagicLinkUCanonicalSerializer } from './MagicLinkUCanonicalSerializer';
import { MagicLinkU } from '../models/core';
import { Request, Response, NextFunction } from 'express';
import * as crypto from 'crypto';

/**
 * MagicLinkValidator:
 * - Express middleware for magic-link ?u validation, signature, expiry, and business checks.
 * - Also: delegate for validating magic-link (used from EmailDeliveryHandler).
 */
class MagicLinkValidator {
  private bridgeApiClient: IBridgeApiClient;
  private getHmacSecretForStore: (storeId: string) => string;

  constructor(deps: {
    bridgeApiClient: IBridgeApiClient;
    config: { getHmacSecretForStore: (storeId: string) => string };
  }) {
    this.bridgeApiClient = deps.bridgeApiClient;
    this.getHmacSecretForStore = deps.config.getHmacSecretForStore;
  }

  /**
   * Express middleware for magic-link ?u validation.
   * Attaches decoded MagicLinkU as req.validatedUData if valid.
   */
  async validateU(
    req: Request,
    res: Response,
    next: NextFunction
  ): Promise<void> {
    try {
      // 1. Extract u parameter
      const uBlob = typeof req.query.u === 'string'
        ? req.query.u
        : Array.isArray(req.query.u)
        ? req.query.u[0]
        : undefined;
      if (!uBlob) {
        res.status(400).json({ error: 'Missing magic-link ?u parameter' });
        return;
      }

      // 2. Decode and parse
      let decoded: any;
      try {
        const buf = MagicLinkUCanonicalSerializer.base64urlDecode(uBlob);
        decoded = JSON.parse(buf.toString('utf8'));
      } catch {
        res.status(400).json({ error: 'Invalid magic-link encoding' });
        return;
      }

      // 3. Canonical signature payload, signature src
      const storeId = decoded.storeId;
      if (!storeId) {
        res.status(400).json({ error: 'Invalid magic-link: missing storeId' });
        return;
      }

      const hmacSecret = this.getHmacSecretForStore(storeId);
      if (!hmacSecret) {
        res.status(403).json({ error: 'No hmacSecret found for store' });
        return;
      }

      const sigPayload = MagicLinkUCanonicalSerializer.buildSignaturePayload(decoded);
      const sigSrc = MagicLinkUCanonicalSerializer.canonicalJSONStringify(sigPayload);

      // 4. Calculate MAC (buffer)
      const calcSig = crypto.createHmac('sha256', Buffer.from(hmacSecret, 'utf8'))
        .update(sigSrc, 'utf8')
        .digest();

      // 5. Provided signature (buffer)
      if (!decoded.sig) {
        res.status(403).json({ error: 'Missing signature in magic-link' });
        return;
      }
      const providedSig = MagicLinkUCanonicalSerializer.base64urlDecode(decoded.sig);

      if (!MagicLinkUCanonicalSerializer.timingSafeEqual(calcSig, providedSig)) {
        res.status(403).json({ error: 'Invalid magic-link signature' });
        return;
      }

      // 6. Cross-check path params match payload
      if (req.params.storeId !== decoded.storeId) {
        res.status(409).json({ error: 'Magic-link store mismatch' });
        return;
      }
      if ('invoiceId' in decoded && req.params.invoiceId && decoded.invoiceId !== req.params.invoiceId) {
        res.status(409).json({ error: 'Magic-link invoice mismatch' });
        return;
      }
      if ('subscriptionId' in decoded && req.params.subscriptionId && decoded.subscriptionId !== req.params.subscriptionId) {
        res.status(409).json({ error: 'Magic-link subscription mismatch' });
        return;
      }

      // 7. Expiry and TTL checks
      const now = Math.floor(Date.now() / 1000);
      if (typeof decoded.exp !== 'number' || decoded.exp <= now) {
        res.status(410).json({ error: 'Magic-link expired' });
        return;
      }
      if (decoded.exp > now + 1800) {
        res.status(400).json({ error: 'Magic-link TTL too long' });
        return;
      }

      // 8. UncheckedCall shape/fields validation
      const call = decoded.unsignedCall;
      if (
        !call ||
        typeof call.function !== 'string' ||
        typeof call.postConditionMode !== 'string' ||
        !Array.isArray(call.postConditions) ||
        typeof call.network !== 'string'
      ) {
        res.status(400).json({ error: 'Invalid unsignedCall in magic-link' });
        return;
      }

      // 9. Function: "pay-invoice" or "pay-subscription"
      let requiredFn = 'pay-invoice';
      let idField = 'invoiceId';
      if ('subscriptionId' in decoded) {
        requiredFn = 'pay-subscription';
        idField = 'subscriptionId';
      }
      if (call.function !== requiredFn) {
        res.status(400).json({ error: 'Invalid call function in magic-link' });
        return;
      }

      // 10. PostConditionMode: "deny"
      if (call.postConditionMode !== 'deny') {
        res.status(400).json({ error: 'Invalid postConditionMode in magic-link' });
        return;
      }

      // 11. FT post-condition: at least one, eq, string amount
      const ftCond = call.postConditions.find(
        (p: any) => p.type === 'ft-postcondition' && p.condition === 'eq' && typeof p.amount === 'string'
      );
      if (!ftCond) {
        res.status(400).json({ error: 'No valid FT post-condition in magic-link' });
        return;
      }

      // 12. Network match
      const deployNetwork = process.env.WEBPAY_NETWORK || 'mainnet';
      if (call.network !== deployNetwork) {
        res.status(400).json({ error: 'Network mismatch in magic-link' });
        return;
      }

      // 13. Cross-check invoice/subscription state via Bridge API
      let stateObj: any;
      try {
        if (idField === 'invoiceId') {
          stateObj = await (this.bridgeApiClient as any).getInvoice
            ? await (this.bridgeApiClient as any).getInvoice(decoded.invoiceId)
            : await (this.bridgeApiClient as any).doRequest('GET', `/i/${decoded.invoiceId}`);
        } else {
          stateObj = await (this.bridgeApiClient as any).doRequest(
            'GET',
            `/api/v1/stores/${decoded.storeId}/subscriptions/${decoded.subscriptionId}`
          );
        }
      } catch {
        res.status(409).json({ error: 'Unable to validate invoice/subscription state' });
        return;
      }

      if (idField === 'invoiceId') {
        if (!stateObj || !['PAY_READY', 'pending'].includes(stateObj.status)) {
          res.status(409).json({ error: 'Invoice not payable' });
          return;
        }
        if (Number(stateObj.amountSats) !== Number(ftCond.amount)) {
          res.status(409).json({ error: 'Invoice amount mismatch' });
          return;
        }
        const quoteExp = Math.floor(new Date(stateObj.quoteExpiresAt).getTime() / 1000);
        if (quoteExp < now) {
          res.status(409).json({ error: 'Invoice expired' });
          return;
        }
      } else {
        if (!stateObj || stateObj.status !== 'active') {
          res.status(409).json({ error: 'Subscription not active' });
          return;
        }
      }

      // Attach as validatedUData, continue
      (req as any).validatedUData = decoded as MagicLinkU;
      next();
    } catch (err: any) {
      res.status(400).json({ error: err && err.message ? err.message : 'Magic-link validation error' });
    }
  }

  /**
   * Validates a magic-link from a string URL, storeId, and hmacSecret (delegate for email).
   * Throws on error, returns void on success.
   */
  validateMagicLink(magicLink: string, storeId: string, storeSecrets: { hmacSecret: string }): void {
    if (!magicLink || !storeId || !storeSecrets || !storeSecrets.hmacSecret) {
      throw new Error('Missing required fields for magic-link validation');
    }
    const url = new URL(magicLink);
    const uBlob = url.searchParams.get('u');
    if (!uBlob) throw new Error('Missing magic-link u blob');
    let decoded: any;
    try {
      const buf = MagicLinkUCanonicalSerializer.base64urlDecode(uBlob);
      decoded = JSON.parse(buf.toString('utf8'));
    } catch {
      throw new Error('Invalid magic-link encoding');
    }
    if (!decoded.storeId || decoded.storeId !== storeId) {
      throw new Error('Magic-link storeId mismatch');
    }
    if (!decoded.sig) throw new Error('Missing signature in magic-link payload');
    const sigPayload = MagicLinkUCanonicalSerializer.buildSignaturePayload(decoded);
    const sigSrc = MagicLinkUCanonicalSerializer.canonicalJSONStringify(sigPayload);
    const calcSig = crypto.createHmac('sha256', Buffer.from(storeSecrets.hmacSecret, 'utf8'))
      .update(sigSrc, 'utf8')
      .digest();
    const providedSig = MagicLinkUCanonicalSerializer.base64urlDecode(decoded.sig);
    if (!MagicLinkUCanonicalSerializer.timingSafeEqual(calcSig, providedSig)) {
      throw new Error('Invalid magic-link signature');
    }
  }
}

export { MagicLinkValidator };
