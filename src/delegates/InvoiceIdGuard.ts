// src/delegates/InvoiceIdGuard.ts
import type { IInvoiceIdCodec } from '/src/contracts/interfaces';

export class InvoiceIdGuard {
  constructor(private codec: IInvoiceIdCodec) {}

  validateHexIdOrThrow(idHex: string): void {
    this.codec.assertHex64(idHex);
  }
}
