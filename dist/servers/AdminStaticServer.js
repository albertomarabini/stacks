"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AdminStaticServer = void 0;
const express_1 = __importDefault(require("express"));
const path_1 = __importDefault(require("path"));
const fs_1 = __importDefault(require("fs"));
class AdminStaticServer {
    configureStaticDir(rootAbsPath) {
        // if (!path.isAbsolute(rootAbsPath)) {
        //   throw new TypeError('AdminStaticServer.configureStaticDir requires an absolute path.');
        // }
        // if (!fs.existsSync(rootAbsPath) || !fs.statSync(rootAbsPath).isDirectory()) {
        //   throw new TypeError(`AdminStaticServer.configureStaticDir path does not exist or is not a directory: ${rootAbsPath}`);
        // }
        this.staticDirAbs = rootAbsPath;
        // Serve assets with sensible caching; never auto-serve index.html here.
        this.staticMiddleware = express_1.default.static(rootAbsPath, {
            index: false,
            etag: true,
            lastModified: true,
            // short default for non-fingerprinted files; index will be handled in serveIndex()
            maxAge: '1h',
            setHeaders: (res, filePath) => {
                // Strong cache for typical finger-printed assets, else no-cache for HTML
                if (/\.(?:js|css|map|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(filePath)) {
                    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
                }
                else if (/\.html?$/i.test(filePath)) {
                    res.setHeader('Cache-Control', 'no-cache');
                }
                res.setHeader('X-Content-Type-Options', 'nosniff');
            },
        });
    }
    serveStatic() {
        if (!this.staticMiddleware) {
            throw new TypeError('AdminStaticServer.serveStatic called before configureStaticDir.');
        }
        return this.staticMiddleware;
    }
    serveIndex(_req, res) {
        if (!this.staticDirAbs) {
            throw new TypeError('AdminStaticServer.serveIndex called before configureStaticDir.');
        }
        const indexFile = path_1.default.join(this.staticDirAbs, 'index.html');
        if (!fs_1.default.existsSync(indexFile)) {
            res.status(404).type('text/plain').send('Admin index not found');
            return;
        }
        // Always discourage caching the shell HTML
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(indexFile);
    }
}
exports.AdminStaticServer = AdminStaticServer;
//# sourceMappingURL=AdminStaticServer.js.map