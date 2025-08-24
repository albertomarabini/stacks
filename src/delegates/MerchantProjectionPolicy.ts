// src/delegates/MerchantProjectionPolicy.ts
import type { MerchantRow } from '/src/contracts/domain';

export class MerchantProjectionPolicy {
  getListProjectionSQL(): string {
    return `
      SELECT
        id,
        principal,
        name,
        display_name,
        logo_url,
        brand_color,
        webhook_url,
        active,
        support_email,
        support_url,
        allowed_origins,
        created_at
      FROM merchants
      ORDER BY created_at DESC
    `;
  }

  mapListRow(raw: any): Omit<MerchantRow, 'api_key' | 'hmac_secret'> {
    return {
      id: raw.id as string,
      principal: raw.principal as string,
      name: raw.name ?? undefined,
      display_name: raw.display_name ?? undefined,
      logo_url: raw.logo_url ?? undefined,
      brand_color: raw.brand_color ?? undefined,
      webhook_url: raw.webhook_url ?? undefined,
      active: Number(raw.active),
      support_email: raw.support_email ?? undefined,
      support_url: raw.support_url ?? undefined,
      allowed_origins: raw.allowed_origins ?? undefined,
      created_at: Number(raw.created_at),
    };
  }
}
