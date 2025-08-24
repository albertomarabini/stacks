declare module 'express-rate-limit' {
  import { RequestHandler } from 'express';
  type RateLimitOptions = Record<string, any>;
  function rateLimit(options?: RateLimitOptions): RequestHandler;
  export = rateLimit;
}
