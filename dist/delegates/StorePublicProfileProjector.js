"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.StorePublicProfileProjector = void 0;
class StorePublicProfileProjector {
    project(store) {
        return {
            displayName: store.display_name ?? null,
            logoUrl: store.logo_url ?? null,
            brandColor: store.brand_color ?? null,
            supportEmail: store.support_email ?? null,
            supportUrl: store.support_url ?? null,
        };
    }
}
exports.StorePublicProfileProjector = StorePublicProfileProjector;
//# sourceMappingURL=StorePublicProfileProjector.js.map