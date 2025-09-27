import express, { RequestHandler } from 'express';
import http from 'http';
import { HttpApiServer } from '../src/server/HttpApiServer';

// Types from your codebase
import type { Express as ExpressType } from 'express';
import type { PublicApiController } from '../src/controllers/PublicApiController';
import type { MerchantApiController } from '../src/controllers/MerchantApiController';
import type { AdminApiController } from '../src/controllers/AdminApiController';
import type { HealthController } from '../src/controllers/HealthController';
import type { AdminAuth } from '../src/middleware/AdminAuth';
import type { StoreApiAuth } from '../src/middleware/StoreApiAuth';
import type { CrossTenantMask } from '../src/middleware/CrossTenantMask';
import type { RateLimitPolicy } from '../src/middleware/RateLimitPolicy';
import type { CorsPolicy } from '../src/middleware/CorsPolicy';
import type { AdminStaticServer } from '../src/servers/AdminStaticServer';

function noopMw(): RequestHandler {
  return (_req, _res, next) => next();
}

// Minimal deps
function mkDeps(): { adminCtrl: any; deps: any } {
  const adminCtrl: any = {
    setSbtcToken: async (req: any, res: any) => {
      const { contractAddress, contractName } = req.body || {};
      if (!contractAddress || !contractName) {
        res.status(400).json({ error: 'validation_error' });
        return;
      }
      return res.json({
        call: {
          contractAddress: 'STADMIN',
          contractName: 'sbtc-payment',
          functionName: 'set-sbtc-token',
          functionArgs: [
            { type: 'contract', value: `${contractAddress}.${contractName}` },
          ],
          anchorMode: 'any',
          network: 'testnet',
        },
      });
    },
  };

  const deps = {
    publicCtrl: {} as unknown as PublicApiController,
    merchantCtrl: {} as unknown as MerchantApiController,
    adminCtrl: adminCtrl as AdminApiController,
    healthCtrl: { getRoot: (_req: any, res: any) => res.status(204).end() } as unknown as HealthController,
    adminAuth: {
      authenticateAdmin: (req: any, res: any, next: any) => {
        const tok = req.header('X-Admin-Token') || req.header('X-API-Key') || req.header('Authorization');
        if (!tok) return res.status(401).end();
        return next();
      },
    } as unknown as AdminAuth,
    storeAuth: { verifyApiKey: noopMw() } as unknown as StoreApiAuth,
    crossTenantMask: { enforce: noopMw() } as unknown as CrossTenantMask,
    rateLimit: {
      initLimiters: () => {},
      publicInvoiceViewLimiter: noopMw(),
      publicCreateTxLimiter: noopMw(),
      publicProfileLimiter: noopMw(),
      createInvoiceLimiter: noopMw(),
      subInvoiceLimiter: noopMw(),
    } as unknown as RateLimitPolicy,
    corsPolicy: {} as unknown as CorsPolicy,
    staticServer: {
      serveStatic: () => noopMw(),
      serveIndex: (_req: any, res: any) => res.status(204).end(),
    } as unknown as AdminStaticServer,
    webhookVerifier: noopMw(),
  };

  return { adminCtrl, deps };
}

function buildApp(): ExpressType {
  const app = express();
  app.use(express.json());
  const server = new HttpApiServer();
  const { deps } = mkDeps();
  server.composeRoutesAndMiddleware(app, deps);
  return app;
}

// Simple HTTP helper
function doPost(
  app: ExpressType,
  path: string,
  body: any,
  headers: Record<string, string> = {},
): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const server = app.listen(0, () => {
      const port = (server.address() as any).port;
      const data = JSON.stringify(body || {});
      const req = http.request(
        {
          method: 'POST',
          port,
          path,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data),
            ...headers,
          },
        },
        (res) => {
          let raw = '';
          res.setEncoding('utf8');
          res.on('data', (chunk) => (raw += chunk));
          res.on('end', () => {
            server.close();
            try {
              resolve({
                status: res.statusCode || 0,
                body: raw ? JSON.parse(raw) : {},
              });
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', (e) => reject(e));
      req.write(data);
      req.end();
    });
  });
}

// ── Manual runner ──
(async () => {
  const app = buildApp();

  console.log('▶ Test: requires admin auth');
  const r1 = await doPost(app, '/api/admin/set-sbtc-token', {
    contractAddress: 'ST123',
    contractName: 'sbtc-token',
  });
  console.log('no auth →', r1.status);

  const r2 = await doPost(
    app,
    '/api/admin/set-sbtc-token',
    {},
    { 'X-Admin-Token': 'test-admin-token' },
  );
  console.log('auth but bad payload →', r2.status, r2.body);

  console.log('▶ Test: unsigned call returned');
  const r3 = await doPost(
    app,
    '/api/admin/set-sbtc-token',
    { contractAddress: 'STTESTADMIN', contractName: 'sbtc-token' },
    { 'X-Admin-Token': 'test-admin-token' },
  );
  console.log('good payload →', r3.status, r3.body);

  console.log('▶ Test: missing fields');
  const r4 = await doPost(
    app,
    '/api/admin/set-sbtc-token',
    { contractAddress: 'STONLY' },
    { 'X-Admin-Token': 'test-admin-token' },
  );
  console.log('missing field →', r4.status, r4.body);
})();
