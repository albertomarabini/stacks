import { Invoice, PublicProfile } from '../models/core';

class EmailTemplateRenderer {
  renderInvoiceEmail(invoice: Invoice, branding: PublicProfile, magicLink: string): string {
    const logo = branding.logoUrl
      ? `<img src="${branding.logoUrl}" alt="${branding.displayName || 'Webpay'}" style="max-width:160px;"/>`
      : '';
    const color = branding.brandColor || '#2563eb';
    const name = branding.displayName || 'Webpay Merchant';
    const support = branding.supportEmail
      ? `<p style="font-size:12px;">Need help? <a href="mailto:${branding.supportEmail}">${branding.supportEmail}</a></p>`
      : '';
    return `
      <div style="font-family:Inter,sans-serif;background:#fff;padding:24px 0;max-width:440px;margin:auto;">
        <div style="text-align:center;margin-bottom:18px;">
          ${logo}
        </div>
        <h2 style="color:${color};margin:0 0 8px 0;">${name} Payment Request</h2>
        <p style="font-size:16px;margin-bottom:12px;">You have a new payment request:</p>
        <div style="background:#f8fafc;padding:16px;border-radius:8px;margin-bottom:10px;">
          <strong>Amount:</strong> ${invoice.amountSats} sats<br/><br>
          <strong>Due:</strong> ${invoice.quoteExpiresAt || 'N/A'}<br/><br>
          <strong>Invoice #:</strong> ${invoice.invoiceId}
        </div>
        <a href="${magicLink}" style="background:${color};color:#fff;padding:12px 24px;text-decoration:none;border-radius:6px;font-weight:500;">Pay Now</a>
        ${support}
      </div>
    `;
  }

  renderInvoiceEmailText(invoice: Invoice, branding: PublicProfile, magicLink: string): string {
    const name = branding.displayName || 'Webpay Merchant';
    const support = branding.supportEmail ? `Need help? ${branding.supportEmail}` : '';
    return `
${name} Payment Request

You have a new payment request.
Amount: ${invoice.amountSats} sats
Due: ${invoice.quoteExpiresAt || 'N/A'}
Invoice #: ${invoice.invoiceId}

Open this link to pay:
${magicLink}

${support}
    `.trim();
  }

  getEmailSubject(
    branding: PublicProfile,
    type?: 'subscription' | 'invoice'
  ): string {
    const name = branding.displayName || 'Webpay';
    if (type === 'subscription') {
      return `${name} Subscription Payment Request`;
    }
    return `${name} Payment Request`;
  }

  getEmailFrom(branding: PublicProfile, senderDomain: string): string {
    if (branding.displayName) {
      return `"${branding.displayName}" <${senderDomain}>`;
    }
    return `Webpay <${senderDomain}>`;
  }
}

export { EmailTemplateRenderer };
