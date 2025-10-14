/**
 * /src/server/controllers/merchant/HydrationObjectBuilder.ts
 *
 * Internal delegate for MerchantRouteHandlers.
 * Constructs hydration objects for client islands (POS, invoice views).
 * Stateless, ensures contract shape.
 */

export class HydrationObjectBuilder {
  /**
   * Builds a minimal hydration object for POS islands.
   * @param storeId string
   * @returns object
   */
  buildPosHydration(storeId: string): object {
    return { storeId };
  }

  /**
   * Builds a minimal hydration object for invoice islands.
   * @param invoiceId string
   * @returns object
   */
  buildInvoiceHydration(invoiceId: string): object {
    return { invoiceId };
  }
}
