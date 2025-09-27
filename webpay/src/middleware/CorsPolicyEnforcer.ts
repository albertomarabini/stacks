import { IBridgeApiClient } from '../contracts/interfaces';
import express from 'express';

class CorsPolicyEnforcer {
  private bridgeApiClient: IBridgeApiClient;

  constructor(bridgeApiClient: IBridgeApiClient) {
    this.bridgeApiClient = bridgeApiClient;
  }

  /**
   * Enforces CORS policy for store APIs.
   * Extracts Origin and storeId, fetches live allowedOrigins, sets headers or blocks request.
   */
  async enforceCorsPolicy(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): Promise<void> {
    const origin = req.headers.origin;
    if (!origin) {
      next();
      return;
    }

    let storeId: string | undefined = undefined;
    if (req.params && req.params.storeId) storeId = req.params.storeId;
    else if (req.body && req.body.storeId) storeId = req.body.storeId;
    else if (req.query && req.query.storeId) storeId = req.query.storeId;

    if (!storeId) {
      next();
      return;
    }

    try {
      const profile = await this.bridgeApiClient.getPublicProfile(storeId);
      const allowedOrigins: string[] = Array.isArray((profile as any).allowedOrigins)
        ? (profile as any).allowedOrigins
        : [];

      if (!allowedOrigins.includes(origin)) {
        res.status(403).send({ error: 'CORS not allowed' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Vary', 'Origin');
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.status(204).end();
        return;
      }
      next();
    } catch (_err) {
      res.status(403).send({ error: 'CORS profile error' });
    }
  }
}

export { CorsPolicyEnforcer };
