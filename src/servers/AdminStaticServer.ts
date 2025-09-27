import express, { Request, Response, RequestHandler } from 'express';
import path from 'path';
import fs from 'fs';

export class AdminStaticServer {
  private staticDirAbs?: string;
  private staticMiddleware?: RequestHandler;

  configureStaticDir(rootAbsPath: string): void {
    // if (!path.isAbsolute(rootAbsPath)) {
    //   throw new TypeError('AdminStaticServer.configureStaticDir requires an absolute path.');
    // }
    // if (!fs.existsSync(rootAbsPath) || !fs.statSync(rootAbsPath).isDirectory()) {
    //   throw new TypeError(`AdminStaticServer.configureStaticDir path does not exist or is not a directory: ${rootAbsPath}`);
    // }

    this.staticDirAbs = rootAbsPath;

    // Serve assets with sensible caching; never auto-serve index.html here.
    this.staticMiddleware = express.static(rootAbsPath, {
      index: false,
      etag: true,
      lastModified: true,
      // short default for non-fingerprinted files; index will be handled in serveIndex()
      maxAge: '1h',
      setHeaders: (res, filePath) => {
        // Strong cache for typical finger-printed assets, else no-cache for HTML
        if (/\.(?:js|css|map|svg|png|jpg|jpeg|webp|gif|ico|woff2?|ttf)$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/\.html?$/i.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
      },
    });
  }

  serveStatic(): RequestHandler {
    if (!this.staticMiddleware) {
      throw new TypeError('AdminStaticServer.serveStatic called before configureStaticDir.');
    }
    return this.staticMiddleware;
  }

  serveIndex(_req: Request, res: Response): void {
    if (!this.staticDirAbs) {
      throw new TypeError('AdminStaticServer.serveIndex called before configureStaticDir.');
    }
    const indexFile = path.join(this.staticDirAbs, 'index.html');
    if (!fs.existsSync(indexFile)) {
      res.status(404).type('text/plain').send('Admin index not found');
      return;
    }
    // Always discourage caching the shell HTML
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(indexFile);
  }
}
