// src/delegates/StorePublicProfileProjector.ts
import type { StorePublicProfileDTO } from '../contracts/domain';

export type StoreLike = {
  display_name?: string | null;
  logo_url?: string | null;
  brand_color?: string | null;
  support_email?: string | null;
  support_url?: string | null;
};

export class StorePublicProfileProjector {
  project(store: StoreLike): StorePublicProfileDTO {
    return {
      displayName: store.display_name ?? null,
      logoUrl: store.logo_url ?? null,
      brandColor: store.brand_color ?? null,
      supportEmail: store.support_email ?? null,
      supportUrl: store.support_url ?? null,
    };
  }
}
