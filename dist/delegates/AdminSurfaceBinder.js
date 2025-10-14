"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminSurfaceBinder = void 0;
class AdminSurfaceBinder {
    constructor() {
        this.mountedAuth = false;
        this.mountedStatic = false;
        this.mountedIndex = false;
    }
    bindAdminAuth(app, adminAuth) {
        if (this.mountedAuth)
            return;
        app.use(['/admin', '/api/admin'], (req, res, next) => adminAuth.authenticateAdmin(req, res, next));
        this.mountedAuth = true;
    }
    bindAdminStatic(app, adminAuth, staticMiddleware) {
        this.bindAdminAuth(app, adminAuth);
        if (this.mountedStatic)
            return;
        app.use('/admin', (req, res, next) => adminAuth.authenticateAdmin(req, res, next), staticMiddleware);
        this.mountedStatic = true;
    }
    bindAdminIndex(app, adminAuth, serveIndex) {
        this.bindAdminAuth(app, adminAuth);
        if (this.mountedIndex)
            return;
        app.get('/admin', (req, res, next) => adminAuth.authenticateAdmin(req, res, next), (req, res) => serveIndex(req, res));
        this.mountedIndex = true;
    }
}
exports.AdminSurfaceBinder = AdminSurfaceBinder;
//# sourceMappingURL=AdminSurfaceBinder.js.map