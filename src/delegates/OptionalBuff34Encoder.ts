// src/delegates/OptionalBuff34Encoder.ts
import type { ClarityValue } from '@stacks/transactions';
import { bufferCV, someCV, noneCV } from '@stacks/transactions';

export class OptionalBuff34Encoder {
  encodeOptionalUtf8ToBuff34(input?: string | null): ClarityValue {
    if (input === undefined || input === null || input === '') {
      return noneCV();
    }
    const buf = Buffer.from(input, 'utf8').subarray(0, 34);
    return someCV(bufferCV(buf));
  }
}
