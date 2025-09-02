declare module 'cors' {
    import { RequestHandler } from 'express';
    export interface CorsOptions {
      origin?: boolean | string | RegExp | (string | RegExp)[]
        | ((origin: string | undefined, cb: (err: Error | null, allow?: boolean) => void) => void);
      methods?: string | string[];
      allowedHeaders?: string | string[];
      exposedHeaders?: string | string[];
      credentials?: boolean;
      maxAge?: number;
      preflightContinue?: boolean;
      optionsSuccessStatus?: number;
    }
    const cors: (options?: CorsOptions) => RequestHandler;
    export default cors;
  }
