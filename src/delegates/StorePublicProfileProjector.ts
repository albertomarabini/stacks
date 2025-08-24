// src/delegates/StorePublicProfileProjector.ts
import type { StorePublicProfileDTO } from '/src/contracts/domain';

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
      displayName: store.display_name ?? undefined,
      logoUrl: store.logo_url ?? undefined,
      brandColor: store.brand_color ?? undefined,
      supportEmail: store.support_email ?? undefined,
      supportUrl: store.support_url ?? undefined,
    };
  }
}
