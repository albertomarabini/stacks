import rateLimit from 'express-rate-limit';

export class RateLimitPolicy {
  public publicInvoiceViewLimiter!: import('express').RequestHandler;
  public publicProfileLimiter!: import('express').RequestHandler;
  public publicCreateTxLimiter!: import('express').RequestHandler;
  public createInvoiceLimiter!: import('express').RequestHandler;
  public subInvoiceLimiter!: import('express').RequestHandler;

  initLimiters(): void {
    const publicWindowMs = 60_000;
    const publicMax = 30;

    const merchantWindowMs = 60_000;
    const merchantMax = 30;

    const subWindowMs = 60_000;
    const subMax = 30;

    this.publicInvoiceViewLimiter = this.buildPublicLimiter(
      this.publicInvoiceViewLimiterHandler.bind(this),
      publicWindowMs,
      publicMax
    );

    this.publicProfileLimiter = this.buildPublicLimiter(
      this.publicProfileLimiterHandler.bind(this),
      publicWindowMs,
      publicMax
    );

    this.publicCreateTxLimiter = this.buildPublicLimiter(
      this.publicCreateTxLimiterHandler.bind(this),
      publicWindowMs,
      publicMax
    );

    this.createInvoiceLimiter = this.buildMerchantLimiter(
      this.createInvoiceLimiterHandler.bind(this),
      merchantWindowMs,
      merchantMax
    );

    this.subInvoiceLimiter = this.buildSubInvoiceLimiter(subWindowMs, subMax);
  }

  publicInvoiceViewLimiterHandler(req: import('express').Request, res: import('express').Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }

  publicProfileLimiterHandler(req: import('express').Request, res: import('express').Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }

  publicCreateTxLimiterHandler(req: import('express').Request, res: import('express').Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }

  createTxLimiterHandler(req: import('express').Request, res: import('express').Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }

  createInvoiceLimiterHandler(req: import('express').Request, res: import('express').Response): void {
    res.status(429).json({ error: 'rate_limited' });
  }

  buildSubInvoiceLimiter(windowMs?: number, max?: number): import('express').RequestHandler {
    const handler = this.subInvoiceLimiterHandler.bind(this);
    return rateLimit({
      windowMs: windowMs ?? 60_000,
      max: max ?? 30,
      standardHeaders: true,
      legacyHeaders: false,
      handler,
      keyGenerator: (req) => {
        const anyReq = req as any;
        const storeId = String(anyReq.store.id);
        const apiKeyHeader = String(req.headers['x-api-key'] ?? (req.headers as any)['X-API-Key']);
        return `${storeId}|${apiKeyHeader}`;
      },
    });
  }

  subInvoiceLimiterHandler(req: import('express').Request, res: import('express').Response): void {
    res.status(429).json({ error: 'rate_limited' });
  }

  private buildPublicLimiter(
    handler: (req: import('express').Request, res: import('express').Response) => void,
    windowMs: number,
    max: number
  ): import('express').RequestHandler {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      handler,
    });
  }

  private buildMerchantLimiter(
    handler: (req: import('express').Request, res: import('express').Response) => void,
    windowMs: number,
    max: number
  ): import('express').RequestHandler {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      handler,
    });
  }
}
