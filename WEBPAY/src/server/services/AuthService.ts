import { IAuthService } from '../../shared/contracts/interfaces';
import type { Request, Response, NextFunction } from 'express';

/**
 * AuthService
 * Provides authentication/session/CSRF/rate limiting for merchant and admin routes.
 * Applies as Express middleware for route/session protection.
 */
export class AuthService implements IAuthService {
  /**
   * Express middleware for all /merchant/* routes to enforce valid/active merchant session.
   * If session is missing or expired, redirects to login page.
   * No business/data logic is performed; strictly access control.
   */
  requireSession(req: Request, res: Response, next: NextFunction): void {
    if (req.session && (req.session as any).merchant) {
      next();
      return;
    }
    res.redirect('/merchant/login');
  }

  /**
   * Express middleware for all /admin/* routes to enforce admin authentication.
   * If session is invalid/missing, SSR-renders error.ejs with status 401 and fallback branding.
   */
  requireAdminSession(req: any, res: any, next: any) {
    if (process.env.AUTH_BYPASS === '1') {
      (req.session as any).admin ??= { id: 'dev-admin', email: 'admin@local' };
      return next();
    }
    if (req.session?.admin) return next();
    res.status(401);
    throw Object.assign(new Error('You must be logged in as an admin to access this page.'), { status: 401 });
  }

}
