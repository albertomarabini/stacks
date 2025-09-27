import express from 'express';
import path from 'path';

class StaticAssetHandler {
  /**
   * Registers the static middleware for serving assets from assetDir at '/static' URL path.
   * Must be called at application startup, before registering other routes.
   * Stateless; no business logic.
   * @param app - Express application instance
   * @param assetDir - Absolute path to static assets directory
   */
  public static register(app: express.Express, assetDir: string): void {
    app.use('/static', express.static(assetDir));
  }
}

export { StaticAssetHandler };
