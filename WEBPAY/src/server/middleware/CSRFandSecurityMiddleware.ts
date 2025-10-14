import csurf from 'csurf';
import helmet from 'helmet';
import rateLimit, { Options as RateLimitOptions } from 'express-rate-limit';

import { RequestHandler, Request, Response, NextFunction } from 'express';

export class CSRFandSecurityMiddleware {
  /**
   * Returns the csurf middleware for CSRF protection.
   * To be applied to authenticated (merchant/admin) routes.
   */
  static csrfProtection(): RequestHandler {
    return csurf();
  }

  /**
   * Returns a middleware that disables CSRF for public endpoints.
   * Should be applied as a per-route override for public GET/POST.
   */
  static disableCsrf(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => next();
  }

  /**
   * Returns the helmet middleware for CSP/security headers.
   * Should be applied globally or per-route as needed.
   */
  static helmetCSP(): RequestHandler {
      return helmet({
        contentSecurityPolicy: {
          useDefaults: true,
          directives: {
            "default-src": ["'self'"],
            // allow inline <style> tags AND style="..." attributes
            "style-src": ["'self'", "'unsafe-inline'"],
            // optional granularity; some browsers use these level-3 directives
            "style-src-attr": ["'self'", "'unsafe-inline'"],
            "style-src-elem": ["'self'", "'unsafe-inline'"],
            // you have inline <script> in several pages
            "script-src": ["'self'", "'unsafe-inline'"],
            "img-src": ["'self'", "data:", "blob:", "https:"],
            // allow app calls + devtools virtual schemes + websockets
            "connect-src": ["'self'", "https:", "http:", "wss:", "ws:", "data:", "blob:", "webpack:"],

          },
        },
      });
    }

  /**
   * Returns an express-rate-limit middleware for sensitive endpoints.
   * Can be configured per route as needed.
   */
  static rateLimiter(options?: RateLimitOptions): RequestHandler {
    return rateLimit({
      windowMs: 60 * 1000,
      max: 30,
      standardHeaders: true,
      legacyHeaders: false,
      ...options,
    });
  }

}
