/**
 * /src/server/middleware/ErrorMiddleware.ts
 *
 * Global Express error handler. Converts all propagated errors into SSR-rendered error pages with branding and friendly messages.
 * Never exposes stack traces or secrets. Consumes BrandingService and SSRViewRenderer.
 */

import type { IErrorMiddleware, IBrandingService, ISSRViewRenderer } from '../../shared/contracts/interfaces';
import type { Branding } from '../../shared/models/dto';

/**
 * ErrorMiddleware acts as the global terminal error handler for all unhandled errors in the Express middleware chain.
 * Converts all errors into user-friendly SSR-rendered error pages with proper branding and HTTP status.
 */
export class ErrorMiddleware implements IErrorMiddleware {
  private brandingService: IBrandingService;
  private ssrViewRenderer: typeof import('../../server/views/SSRViewRenderer').SSRViewRenderer;

  /**
   * @param brandingService IBrandingService - injected, must implement fetchBranding and injectFallbackBranding
   * @param ssrViewRenderer SSRViewRenderer class reference (static utility), must implement renderPartialWithContext etc.
   */
  constructor(
    brandingService: IBrandingService,
    ssrViewRenderer: typeof import('../../server/views/SSRViewRenderer').SSRViewRenderer
  ) {
    this.brandingService = brandingService;
    this.ssrViewRenderer = ssrViewRenderer;
  }

  /**
   * Express error-handling middleware (signature: (err, req, res, next)).
   * Converts any error (validation, Bridge API, session, CSRF, unexpected) into a user-friendly SSR-rendered error page.
   * - Maps error to sanitized message/code (removes stack traces, technical details, secrets).
   * - Ensures branding is injected (fallback if needed).
   * - Sets HTTP status.
   * - Renders error.ejs via SSRViewRenderer with { error: { message, code }, branding }.
   * - Never exposes stack traces or secrets to client.
   * - No further processing after rendering.
   */
  handleError(
    err: Error & { status?: number; code?: number | string },
    req: any,
    res: any,
    next: any
  ): void {
    const mapped = ErrorMiddleware.mapError(err);

    let branding: Branding = res.locals && res.locals.branding
      ? res.locals.branding
      : this.brandingService.injectFallbackBranding();

    res.status(mapped.status);
    const html = this.ssrViewRenderer.renderPartialWithContext('error', {
      error: {
        message: mapped.message,
        code: mapped.status,          // always numeric, matches HTTP status
        // optionally keep a reason code for logs/telemetry (not shown to users):
        // reason: typeof err.code === 'string' ? err.code : undefined,
      },
      branding,
    });
    res.send(html);
  }

  /**
   * Business contract error mapping: maps any error object to a user-friendly message and code.
   * Strips stack traces/technical details.
   */
  static mapError(err: Error & { status?: number; code?: number | string }): {
    message: string;
    code?: number | string;
    status: number;
  } {
    const statusFromErr =
      typeof err.status === 'number' ? err.status :
        typeof err.code === 'number' ? err.code :
          undefined;
    // CSRF
    if (
      typeof err.code === 'string' &&
      (err.code === 'EBADCSRFTOKEN' || (err.message && err.message.toLowerCase().includes('csrf')))
    ) {
      return { message: 'Security Error: Your session has expired or the form is invalid. Please refresh the page and try again.', code: 403, status: 403 };
    }

    // Unauthorized / Forbidden
    if (
      statusFromErr === 401 || statusFromErr === 403 ||
      (typeof err.code === 'string' && ['UNAUTHORIZED', 'FORBIDDEN'].includes(err.code.toUpperCase()))
    ) {
      return {
        message: 'Your session has expired or you are not authorized. Please log in again.',
        code: 403,          // <- force numeric for display consistency
        status: 403,
      };
    }

    // Known validation/business errors (400–499)
    if (statusFromErr && statusFromErr >= 400 && statusFromErr < 500) {
      return {
        message: err.message || 'Request could not be completed (Bad Request).',
        code: statusFromErr,   // <- numeric mirrors status
        status: statusFromErr,
      };
    }

    // Fallback: server error
    return {
      message: 'A server error occurred. Please try again later.',
      code: 500,
      status: 500,
    };
  }

}
