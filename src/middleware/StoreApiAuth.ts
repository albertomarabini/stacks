// src/middleware/StoreApiAuth.ts
import type { Request, Response, NextFunction } from 'express';
import type { ISqliteStore } from '/src/contracts/dao';

declare global {
  namespace Express {
    interface Request {
      store?: any;
    }
  }
}

export class StoreApiAuth {
  private store?: ISqliteStore;

  bindStore(store: ISqliteStore): void {
    this.store = store;
  }

  verifyApiKey(req: Request, res: Response, next: NextFunction): void {
    if (!this.store) {
      res.status(401).end();
      return;
    }

    const apiKey =
      req.get('X-API-Key') ||
      req.get('x-api-key') ||
      (req.headers['x-api-key'] as string | undefined);

    if (!apiKey) {
      res.status(401).end();
      return;
    }

    const merchant = this.store.findActiveByApiKey(apiKey);
    if (!merchant) {
      res.status(401).end();
      return;
    }

    (req as any).store = merchant;
    next();
  }
}
