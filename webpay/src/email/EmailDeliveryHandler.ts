import { IBridgeApiClient, IBrandingProfileManager, IErrorHandler } from '../contracts/interfaces';
import { MagicLinkValidator } from '../validation/MagicLinkValidator';
import { EmailTemplateRenderer } from './EmailTemplateRenderer';
import { PostmarkApiClient } from './PostmarkApiClient';
import { EmailRecipientValidator } from './EmailRecipientValidator';
import { Invoice, PublicProfile, MagicLinkDTO } from '../models/core';
import { config } from '../config/config';

class EmailDeliveryHandler {
  private bridgeApiClient: IBridgeApiClient;
  private postmarkApiClient: PostmarkApiClient;
  private brandingProfileManager: IBrandingProfileManager;
  private errorHandler: IErrorHandler;
  private magicLinkValidator: MagicLinkValidator;
  private emailTemplateRenderer: EmailTemplateRenderer;
  private emailRecipientValidator: EmailRecipientValidator;

  constructor(deps: {
    bridgeApiClient: IBridgeApiClient;
    postmarkApiClient: PostmarkApiClient;
    brandingProfileManager: IBrandingProfileManager;
    errorHandler: IErrorHandler;
  }) {
    this.bridgeApiClient = deps.bridgeApiClient;
    this.postmarkApiClient = deps.postmarkApiClient;
    this.brandingProfileManager = deps.brandingProfileManager;
    this.errorHandler = deps.errorHandler;
    this.magicLinkValidator = new MagicLinkValidator({
      bridgeApiClient: this.bridgeApiClient,
      config: {
        getHmacSecretForStore: (storeId: string) => {
          const secrets = config.STORE_SECRETS[storeId];
          return secrets ? secrets.hmacSecret : undefined;
        }
      }
    });
    this.emailTemplateRenderer = new EmailTemplateRenderer();
    this.emailRecipientValidator = new EmailRecipientValidator();
  }

  /**
   * Handles sending an invoice email notification (single invoice flow).
   * @param data { invoiceId: string; recipientEmail: string }
   */
  async handleInvoiceCreated(data: { invoiceId: string; recipientEmail: string }): Promise<void> {
    try {
      this.emailRecipientValidator.validateRecipientEmail(data.recipientEmail);

      // Fetch invoice, magic-link, and store branding
      const invoice: Invoice = await (this.bridgeApiClient as any).doRequest(
        'GET',
        `/i/${data.invoiceId}`
      );
      const storeId: string = invoice.storeId;
      const magicLinkDTO: MagicLinkDTO = await (this.bridgeApiClient as any).doRequest(
        'GET',
        `/api/v1/stores/${storeId}/invoices/${data.invoiceId}/magic-link`
      );
      const branding: PublicProfile = await this.bridgeApiClient.getPublicProfile(storeId);

      // Validate magic-link signature using current store secrets
      const secrets = config.STORE_SECRETS[storeId];
      this.magicLinkValidator.validateMagicLink(magicLinkDTO.magicLink, storeId, secrets);

      // Render email content
      const htmlBody = this.emailTemplateRenderer.renderInvoiceEmail(invoice, branding, magicLinkDTO.magicLink);
      const textBody = this.emailTemplateRenderer.renderInvoiceEmailText(invoice, branding, magicLinkDTO.magicLink);
      const subject = this.emailTemplateRenderer.getEmailSubject(branding, 'invoice');
      const fromEmail = this.emailTemplateRenderer.getEmailFrom(branding, config.SENDER_DOMAIN);

      // Send via Postmark
      await this.postmarkApiClient.sendEmail({
        To: data.recipientEmail,
        From: fromEmail,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: 'outbound'
      }, config.POSTMARK_API_KEY);
    } catch (err: any) {
      if (err && err.message && (
        err.message.startsWith('Invalid recipientEmail') ||
        err.message.startsWith('Missing recipientEmail')
      )) {
        this.handleEmailValidationFailure(err);
        throw err;
      }
      this.handlePostmarkApiError(err);
      throw err;
    }
  }

  /**
   * Handles sending a subscription-linked invoice email.
   * @param data { invoiceId: string; subscriptionId: string; recipientEmail: string }
   */
  async handleSubscriptionInvoiceCreated(data: { invoiceId: string; subscriptionId: string; recipientEmail: string }): Promise<void> {
    try {
      this.emailRecipientValidator.validateRecipientEmail(data.recipientEmail);

      // Fetch invoice, magic-link, and store branding
      const invoice: Invoice = await (this.bridgeApiClient as any).doRequest(
        'GET',
        `/i/${data.invoiceId}`
      );
      const storeId: string = invoice.storeId;
      const magicLinkDTO: MagicLinkDTO = await (this.bridgeApiClient as any).doRequest(
        'GET',
        `/api/v1/stores/${storeId}/subscriptions/${data.subscriptionId}/linked-invoices/${data.invoiceId}/magic-link`
      );
      const branding: PublicProfile = await this.bridgeApiClient.getPublicProfile(storeId);

      // Validate magic-link signature using current store secrets
      const secrets = config.STORE_SECRETS[storeId];
      this.magicLinkValidator.validateMagicLink(magicLinkDTO.magicLink, storeId, secrets);

      // Render email content
      const htmlBody = this.emailTemplateRenderer.renderInvoiceEmail(invoice, branding, magicLinkDTO.magicLink);
      const textBody = this.emailTemplateRenderer.renderInvoiceEmailText(invoice, branding, magicLinkDTO.magicLink);
      const subject = this.emailTemplateRenderer.getEmailSubject(branding, 'subscription');
      const fromEmail = this.emailTemplateRenderer.getEmailFrom(branding, config.SENDER_DOMAIN);

      // Send via Postmark
      await this.postmarkApiClient.sendEmail({
        To: data.recipientEmail,
        From: fromEmail,
        Subject: subject,
        HtmlBody: htmlBody,
        TextBody: textBody,
        MessageStream: 'outbound'
      }, config.POSTMARK_API_KEY);
    } catch (err: any) {
      if (err && err.message && (
        err.message.startsWith('Invalid recipientEmail') ||
        err.message.startsWith('Missing recipientEmail')
      )) {
        this.handleEmailValidationFailure(err);
        throw err;
      }
      this.handlePostmarkApiError(err);
      throw err;
    }
  }

  /**
   * Called after Postmark API response is received (success).
   * Used for UI feedback/status.
   */
  handlePostmarkApiResponse(response: object): void {
    // No-op; actual UI/status update is handled at API/route response level.
    // This method is included for the contract; all send status is ephemeral.
  }

  /**
   * Called when validation fails (pre-send).
   * Returns HTTP 400+ and disables sent-status.
   */
  handleEmailValidationFailure(error: Error): void {
    if (typeof window === 'undefined') {
      throw {
        statusCode: 400,
        message: error.message
      };
    } else {
      this.errorHandler.handleBridgeApiError(error);
    }
  }

  /**
   * Called when Postmark API returns error/exception.
   * Returns HTTP 500+ and disables sent-status.
   */
  handlePostmarkApiError(error: Error): void {
    if (typeof window === 'undefined') {
      throw {
        statusCode: 500,
        message: error && error.message ? error.message : 'Email delivery failed'
      };
    } else {
      this.errorHandler.handleBridgeApiError(error);
    }
  }
}

export { EmailDeliveryHandler };
