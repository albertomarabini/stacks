// src/delegates/MerchantCreationService.ts
import crypto from 'crypto';
import type { ISqliteStore } from '../contracts/dao';
import type { MerchantRow } from '../contracts/domain';
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
      display_name: body.display_name ?? undefined,
      logo_url: body.logo_url ?? undefined,
      brand_color: body.brand_color ?? undefined,
      webhook_url: body.webhook_url ?? undefined,
      hmac_secret: hmacSecret,
      stx_private_key: apiKey,
      active: 1,
      support_email: body.support_email ?? undefined,
      support_url: body.support_url ?? undefined,
      allowed_origins: body.allowed_origins ?? undefined,
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
