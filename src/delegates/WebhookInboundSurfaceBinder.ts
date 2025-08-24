import type { Express, RequestHandler } from 'express';
import express from 'express';

export class WebhookInboundSurfaceBinder {
  private mounted = false;

  public bind(app: Express, verifierMw: RequestHandler): void {
    if (this.mounted) return;
    app.use(
      '/webhooks/inbound',
      express.raw({ type: 'application/json' }),
      verifierMw,
    );
    this.mounted = true;
  }
}
