// src/delegates/MerchantCreationService.ts
import crypto from 'crypto';
import type { ISqliteStore } from '/src/contracts/dao';
import type { MerchantRow } from '/src/contracts/domain';
import type { MerchantDto } from './AdminDtoProjector';

export class MerchantCreationService {
  async create(
    store: ISqliteStore,
    body: any
  ): Promise<{ status: 'created'; dto: MerchantDto } | { status: 'conflict' }> {
    const id = crypto.randomUUID();
    const createdAt = Math.floor(Date.now() / 1000);
    const apiKey = crypto.randomBytes(32).toString('hex');
    const hmacSecret = crypto.randomBytes(32).toString('hex');

    const insertRow: MerchantRow | any = {
      id,
      principal: String(body.principal),
      name: body.name ?? undefined,
      display_name: body.displayName ?? undefined,
      logo_url: body.logoUrl ?? undefined,
      brand_color: body.brandColor ?? undefined,
      webhook_url: body.webhookUrl ?? undefined,
      hmac_secret: hmacSecret,
      api_key: apiKey,
      active: 1,
      support_email: body.supportEmail ?? undefined,
      support_url: body.supportUrl ?? undefined,
      allowed_origins: body.allowedOrigins ?? undefined,
      created_at: createdAt,
    };

    try {
      store.insertMerchant(insertRow as MerchantRow);
    } catch (e: any) {
      if (e && (e.code === 'SQLITE_CONSTRAINT' || e.errno === 19)) {
        return { status: 'conflict' };
      }
      throw e;
    }

    const dto: MerchantDto = {
      id,
      principal: insertRow.principal,
      name: insertRow.name ?? undefined,
      displayName: insertRow.display_name ?? undefined,
      logoUrl: insertRow.logo_url ?? undefined,
      brandColor: insertRow.brand_color ?? undefined,
      webhookUrl: insertRow.webhook_url ?? undefined,
      active: true,
      supportEmail: insertRow.support_email ?? undefined,
      supportUrl: insertRow.support_url ?? undefined,
      allowedOrigins: insertRow.allowed_origins ?? undefined,
      createdAt,
    };

    return { status: 'created', dto };
  }
}
