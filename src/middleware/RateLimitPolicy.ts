// RateLimitPolicy.ts
import rateLimit from 'express-rate-limit';
import type { Request, Response, RequestHandler } from 'express';

export class RateLimitPolicy {
  public publicInvoiceViewLimiter!: RequestHandler;
  public publicProfileLimiter!: RequestHandler;
  public publicCreateTxLimiter!: RequestHandler;
  public createInvoiceLimiter!: RequestHandler;
  public subInvoiceLimiter!: RequestHandler;

  initLimiters(): void {
    const publicWindowMs   = Number(process.env.RL_PUBLIC_WINDOW_MS   ?? 60_000);
    const publicMax        = Number(process.env.RL_PUBLIC_MAX         ?? 30);
    const merchantWindowMs = Number(process.env.RL_MERCHANT_WINDOW_MS ?? 60_000);
    const merchantMax      = Number(process.env.RL_MERCHANT_MAX       ?? 30);
    const subWindowMs      = Number(process.env.RL_SUB_WINDOW_MS      ?? 60_000);
    const subMax           = Number(process.env.RL_SUB_MAX            ?? 30);

    this.publicInvoiceViewLimiter = this.buildPublicLimiter(
      this.publicInvoiceViewLimiterHandler.bind(this), publicWindowMs, publicMax);
    this.publicProfileLimiter = this.buildPublicLimiter(
      this.publicProfileLimiterHandler.bind(this), publicWindowMs, publicMax);
    this.publicCreateTxLimiter = this.buildPublicLimiter(
      this.publicCreateTxLimiterHandler.bind(this), publicWindowMs, publicMax);

    this.createInvoiceLimiter = this.buildMerchantLimiter(
      this.createInvoiceLimiterHandler.bind(this), merchantWindowMs, merchantMax);

    this.subInvoiceLimiter = this.buildSubInvoiceLimiter(subWindowMs, subMax);
  }

  // ----- Express handlers you want called on limit -----
  publicInvoiceViewLimiterHandler(req: Request, res: Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }
  publicProfileLimiterHandler(req: Request, res: Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }
  publicCreateTxLimiterHandler(req: Request, res: Response): void {
    res.status(429).json({ reason: 'rateLimited' });
  }
  createInvoiceLimiterHandler(req: Request, res: Response): void {
    res.status(429).json({ error: 'rate_limited' });
  }
  subInvoiceLimiterHandler(req: Request, res: Response): void {
    res.status(429).json({ error: 'rate_limited' });
  }

  // ----- Adapters (v7 expects Fetch-like request/response) -----
  private toExpressOnLimit(
    fn: (req: Request, res: Response) => void,
  ) {
    return (request: unknown, response: unknown) => {
      fn(request as Request, response as Response);
    };
  }

  // ----- Builders -----
  private buildPublicLimiter(
    onLimit: (req: Request, res: Response) => void,
    windowMs: number,
    max: number,
  ): RequestHandler {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: this.toExpressOnLimit(onLimit),
      // public routes can use default key (req.ip); see trust proxy note below
    }) as unknown as RequestHandler;
  }

  private buildMerchantLimiter(
    onLimit: (req: Request, res: Response) => void,
    windowMs: number,
    max: number,
  ): RequestHandler {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: this.toExpressOnLimit(onLimit),
      keyGenerator: (req: any) => {
        const storeId = String(req.store?.id ?? req.params?.storeId ?? 'unknown');
        const apiKey = String(req.headers['x-api-key'] ?? (req.headers as any)['X-API-Key'] ?? 'no-key');
        return `${storeId}|${apiKey}`;
      },
    }) as unknown as RequestHandler;
  }

  buildSubInvoiceLimiter(windowMs?: number, max?: number): RequestHandler {
    return rateLimit({
      windowMs: windowMs ?? 60_000,
      max: max ?? 30,
      standardHeaders: true,
      legacyHeaders: false,
      handler: this.toExpressOnLimit(this.subInvoiceLimiterHandler.bind(this)),
      keyGenerator: (req: any) => {
        const storeId = String(req.store?.id ?? req.params?.storeId ?? 'unknown');
        const apiKey = String(req.headers['x-api-key'] ?? (req.headers as any)['X-API-Key'] ?? 'no-key');
        return `${storeId}|${apiKey}`;
      },
    }) as unknown as RequestHandler;
  }
}
