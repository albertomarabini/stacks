import type { RequestHandler } from 'express';
import cors from 'cors';

export class CorsMiddlewareFactory {
  public create(
    methods: string[],
    corsPolicy: {
      publicCorsOriginValidator(
        origin: string | undefined,
        cb: (err: Error | null, allow?: boolean) => void,
        req: any,
      ): void;
    },
  ): RequestHandler {
    return (req, res, next) =>
      cors({
        origin: (origin, cb) => corsPolicy.publicCorsOriginValidator(origin, cb, req),
        methods,
        allowedHeaders: [
          'Content-Type',
          'X-API-Key',
          'X-Webhook-Timestamp',
          'X-Webhook-Signature',
        ],
      })(req, res, next);
  }
}
