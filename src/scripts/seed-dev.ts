import path from 'path';
import { openDatabaseAndMigrate } from '/src/db/SqliteStore';

async function main(): Promise<void> {
  const dbPath = process.env.DB_PATH ? String(process.env.DB_PATH) : path.join(process.cwd(), 'data.sqlite');
  const store = openDatabaseAndMigrate(dbPath) as any;

  const nowSecs = Math.floor(Date.now() / 1000);
  const nowMs = Date.now();
  const futureMs = nowMs + 24 * 60 * 60 * 1000;

  const invoiceIdRaw = 'inv-1';
  const invoiceIdHex = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
  const storeId = 'test-store';
  const merchantPrincipal = 'SP0000000000000000000000000000000000000000';
  const apiKey = 'test-api-key';

  try {
    // insert merchant if not exists
    try {
      store.insertMerchant({
        id: storeId,
        principal: merchantPrincipal,
        name: 'Test Store',
        hmac_secret: 'hmac-secret',
        api_key: apiKey,
        active: 1,
        created_at: nowSecs,
      });
    } catch (e) {
      // ignore unique constraint
    }

    // insert invoice if not exists
    try {
      store.invoices.insert({
        id_raw: invoiceIdRaw,
        id_hex: invoiceIdHex,
        store_id: storeId,
        amount_sats: 1000,
        usd_at_create: 10.0,
        quote_expires_at: futureMs,
        merchant_principal: merchantPrincipal,
        status: 'unpaid',
        created_at: nowSecs,
        refund_amount: 0,
      });
    } catch (e) {
      // ignore unique constraint
    }

    // feedback
    // eslint-disable-next-line no-console
    console.log(`Seeded ${dbPath} with store='${storeId}' (api_key='${apiKey}') and invoice='${invoiceIdRaw}'`);
    // eslint-disable-next-line no-console
    console.log('Try these:');
    // eslint-disable-next-line no-console
    console.log(`curl -i http://localhost:3000/`);
    // eslint-disable-next-line no-console
    console.log(`curl -i http://localhost:3000/i/${invoiceIdRaw}`);
    // eslint-disable-next-line no-console
    console.log(`curl -i -H "X-API-Key: ${apiKey}" -H 'Content-Type: application/json' -d '{"amountSats":1000, "memo":"dev test"}' http://localhost:3000/api/v1/stores/${storeId}/invoices`);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('Seeder failed:', err);
    process.exit(1);
  }
}

void main();
