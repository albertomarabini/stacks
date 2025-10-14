import type { IBridgeClient, IInvoiceService } from '../../shared/contracts/interfaces';
import type { InvoiceDTO } from '../../shared/models/dto';

export class InvoiceService implements IInvoiceService {
  private bridgeClient: IBridgeClient;

  constructor(bridgeClient: IBridgeClient) {
    this.bridgeClient = bridgeClient;
  }

  async createInvoice(
    storeId: string,
    amount: number,
    ttl: number,
    memo: string
  ): Promise<InvoiceDTO> {
    const dto = await this.bridgeClient.prepareInvoice(storeId, { amount, ttl, memo });
    // Assumes bridgeClient.normalizeBridgeResponse already returns the DTO shape.
    return dto as InvoiceDTO;
  }

  async fetchInvoice(invoiceId: string): Promise<InvoiceDTO> {
    const dto = await this.bridgeClient.fetchInvoice(invoiceId);
    return dto as InvoiceDTO;
  }

  async fetchFilteredInvoices(storeId: string, filterParams: object): Promise<InvoiceDTO[]> {
    const dtos = await this.bridgeClient.listStoreInvoices(storeId, filterParams);
    return Array.isArray(dtos) ? (dtos as InvoiceDTO[]) : [];
  }

  async fetchInvoices(storeId: string, filters: Record<string, any> = {}): Promise<InvoiceDTO[]> {
    const rows = await this.bridgeClient.listStoreInvoices(storeId, filters);
    return Array.isArray(rows) ? (rows as InvoiceDTO[]) : [];
  }

}
