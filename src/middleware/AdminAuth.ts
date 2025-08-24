// src/middleware/AdminAuth.ts
import type { Request, Response, NextFunction } from 'express';
import type { IConfigService } from '../contracts/interfaces';
import crypto from 'crypto';

export class AdminAuth {
  private bearer?: string;
  private basicUser?: string;
  private basicPass?: string;

  bindCredentialsFromEnv(_cfg: IConfigService): void {
    this.bearer = process.env.ADMIN_TOKEN;
    this.basicUser = process.env.ADMIN_USER;
    this.basicPass = process.env.ADMIN_PASS;
  }

  authenticateAdmin(req: Request, res: Response, next: NextFunction): void {
    const header = req.headers['authorization'] as string | undefined;

    let ok = false;

    if (header && header.startsWith('Bearer ')) {
      const token = header.slice(7).trim();
      if (this.bearer && this.timingSafeEqualStr(token, this.bearer)) {
        ok = true;
      }
    } else if (header && header.startsWith('Basic ')) {
      const payload = header.slice(6).trim();
      const decoded = Buffer.from(payload, 'base64').toString('utf8');
      const idx = decoded.indexOf(':');
      const user = idx >= 0 ? decoded.slice(0, idx) : decoded;
      const pass = idx >= 0 ? decoded.slice(idx + 1) : '';
      if (
        this.basicUser &&
        this.basicPass &&
        this.timingSafeEqualStr(user, this.basicUser) &&
        this.timingSafeEqualStr(pass, this.basicPass)
      ) {
        ok = true;
      }
    }

    if (ok) {
      next();
      return;
    }

    res.status(401).send('Unauthorized');
  }

  private timingSafeEqualStr(a?: string, b?: string): boolean {
    if (typeof a !== 'string' || typeof b !== 'string') return false;
    const ab = Buffer.from(a, 'utf8');
    const bb = Buffer.from(b, 'utf8');
    if (ab.length !== bb.length) return false;
    return crypto.timingSafeEqual(ab, bb);
  }
}
