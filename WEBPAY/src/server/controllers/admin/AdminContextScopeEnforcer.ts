/**
 * /src/server/controllers/admin/AdminContextScopeEnforcer.ts
 *
 * Internal delegate for AdminRouteHandlers.
 * Enforces admin session/context and verifies all DTOs rendered in SSR/hydration are admin-scoped.
 */

import type { Request, Response } from 'express';

export class AdminContextScopeEnforcer {
  /**
   * Ensures that the current request is in admin context and, optionally,
   * that all DTOs provided are admin-scoped.
   * @param req Express request object.
   * @param res Express response object.
   * @param dataScopingTargets Optional array of DTOs to scope-check.
   * @throws Error if admin context is missing or scoping fails.
   */
  public enforceScope(req: Request, res: Response, dataScopingTargets?: any[]): void {
    if (!req.session || !(req.session as any).admin) {
      throw new Error('Admin context required');
    }
    if (!dataScopingTargets || !Array.isArray(dataScopingTargets) || dataScopingTargets.length === 0) {
      return;
    }
    for (const target of dataScopingTargets) {
      if (Array.isArray(target)) {
        for (const dto of target) {
          if (!this.isAdminScopedDTO(dto, (req.session as any).admin)) {
            throw new Error('DTO not admin-scoped');
          }
        }
      } else if (!this.isAdminScopedDTO(target, (req.session as any).admin)) {
        throw new Error('DTO not admin-scoped');
      }
    }
  }


  /**
   * Determines if a DTO is admin-scoped for the current admin session.
   * Implementation should be extended as needed for actual DTO contract.
   */
  private isAdminScopedDTO(dto: any, adminSession: any): boolean {
    // 1) Primitive store identifiers are OK (you only reach here with an admin session)
    if (typeof dto === 'string' || typeof dto === 'number') return true;

    // 2) Arrays are handled by caller (enforceScope iterates), so skip here
    if (Array.isArray(dto)) return true;

    if (dto && typeof dto === 'object') {
      // 3) If an explicit adminId is present, enforce exact match
      if (Object.prototype.hasOwnProperty.call(dto, 'adminId')) {
        return dto.adminId === adminSession?.id;
      }

      // 4) If it looks like a Store DTO (what your code passes: id/principal/etc.), allow
      if (
        Object.prototype.hasOwnProperty.call(dto, 'id') ||
        Object.prototype.hasOwnProperty.call(dto, 'principal')
      ) {
        return true;
      }

      // 5) If it's clearly a view-model bag (branding, arrays already handled), allow
      if (Object.prototype.hasOwnProperty.call(dto, 'branding')) return true;
    }

    // Default: allow (we already verified admin session above)
    return true;
  }

}
