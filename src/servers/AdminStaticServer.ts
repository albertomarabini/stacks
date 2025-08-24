import express, { Request, Response, RequestHandler } from 'express';
import path from 'path';

export class AdminStaticServer {
  private staticDirAbs?: string;
  private staticMiddleware?: RequestHandler;

  configureStaticDir(rootAbsPath: string): void {
    if (!path.isAbsolute(rootAbsPath)) {
      throw new TypeError('AdminStaticServer.configureStaticDir requires an absolute path.');
    }
    this.staticDirAbs = rootAbsPath;
    this.staticMiddleware = express.static(rootAbsPath);
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
    res.sendFile(indexFile);
  }
}
