import type { Express, RequestHandler } from 'express';

export class AdminSurfaceBinder {
  private mountedAuth = false;
  private mountedStatic = false;
  private mountedIndex = false;

  public bindAdminAuth(
    app: Express,
    adminAuth: { authenticateAdmin(req: any, res: any, next: any): void },
  ): void {
    if (this.mountedAuth) return;
    app.use(
      ['/admin', '/api/admin'],
      (req, res, next) => adminAuth.authenticateAdmin(req, res, next),
    );
    this.mountedAuth = true;
  }

  public bindAdminStatic(
    app: Express,
    adminAuth: { authenticateAdmin(req: any, res: any, next: any): void },
    staticMiddleware: RequestHandler,
  ): void {
    this.bindAdminAuth(app, adminAuth);
    if (this.mountedStatic) return;
    app.use(
      '/admin',
      (req, res, next) => adminAuth.authenticateAdmin(req, res, next),
      staticMiddleware,
    );
    this.mountedStatic = true;
  }

  public bindAdminIndex(
    app: Express,
    adminAuth: { authenticateAdmin(req: any, res: any, next: any): void },
    serveIndex: (req: any, res: any) => void,
  ): void {
    this.bindAdminAuth(app, adminAuth);
    if (this.mountedIndex) return;
    app.get(
      '/admin',
      (req, res, next) => adminAuth.authenticateAdmin(req, res, next),
      (req, res) => serveIndex(req, res),
    );
    this.mountedIndex = true;
  }
}
