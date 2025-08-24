// /frontend/admin-console/adapters/AdminStoreFormAdapter.ts

export class AdminStoreFormAdapter {
  static toCreateStoreBody(form: {
    principal: string;
    name?: string;
    display_name?: string;
    logo_url?: string;
    brand_color?: string;
    webhook_url?: string;
    support_email?: string;
    support_url?: string;
    allowed_origins?: string;
  }): {
    principal: string;
    name?: string;
    displayName?: string;
    logoUrl?: string;
    brandColor?: string;
    webhookUrl?: string;
    supportEmail?: string;
    supportUrl?: string;
    allowedOrigins?: string;
  } {
    return {
      principal: form.principal,
      name: form.name ?? undefined,
      displayName: form.display_name ?? undefined,
      logoUrl: form.logo_url ?? undefined,
      brandColor: form.brand_color ?? undefined,
      webhookUrl: form.webhook_url ?? undefined,
      supportEmail: form.support_email ?? undefined,
      supportUrl: form.support_url ?? undefined,
      allowedOrigins: form.allowed_origins ?? undefined,
    };
  }
}
