// src/delegates/MerchantProjectionPolicy.ts
import type { MerchantRow } from '../contracts/domain';

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

  mapListRow(raw: any): Omit<MerchantRow, 'stx_private_key' | 'hmac_secret'> {
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

      // NEW: key-rotation columns
      keys_rotation_version: Number(raw.keys_rotation_version ?? 0),
      keys_last_rotated_at:
        raw.keys_last_rotated_at != null ? Number(raw.keys_last_rotated_at) : undefined,
      keys_last_revealed_at:
        raw.keys_last_revealed_at != null ? Number(raw.keys_last_revealed_at) : undefined,
      keys_dual_valid_until:
        raw.keys_dual_valid_until != null ? Number(raw.keys_dual_valid_until) : undefined,
    };
  }
}
