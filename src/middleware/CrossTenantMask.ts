// src/middleware/CrossTenantMask.ts
import type { Request, Response, NextFunction } from 'express';

export class CrossTenantMask {
  enforce(req: Request, res: Response, next: NextFunction): void {
    const storeId = String((req as any).params.storeId);
    const merchant = (req as any).store;
    if (merchant.id !== storeId) {
      res.status(404).end();
      return;
    }

    next();
  }
}
