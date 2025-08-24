// src/delegates/RootRouteBinder.ts
import type { Express } from 'express';

export class RootRouteBinder {
  private mounted = false;

  public bindRoot(app: Express, handler: { getRoot(req: any, res: any): void }): void {
    if (this.mounted) return;
    app.get('/', (req, res) => handler.getRoot(req, res));
    this.mounted = true;
  }
}
