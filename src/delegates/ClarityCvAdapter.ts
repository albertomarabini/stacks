// src/delegates/ClarityCvAdapter.ts
import type { ClarityValue } from '@stacks/transactions';
import { cvToJSON, cvToString } from '@stacks/transactions';
import type { OnChainSubscription } from '../contracts/domain';

export class ClarityCvAdapter {
  guardHex32(idHex: string): Buffer {
    if (typeof idHex !== 'string' || idHex.length !== 64) {
      throw new Error('idHex must be 64 hex chars');
    }
    const buf = Buffer.from(idHex, 'hex');
    if (buf.length !== 32 || buf.toString('hex') !== idHex.toLowerCase()) {
      throw new Error('idHex must decode to 32 bytes and round-trip');
    }
    return buf;
  }

  decodeOptionalContractPrincipal(
    cv: ClarityValue,
  ): { contractAddress: string; contractName: string } | undefined {
    const asString = cvToString(cv);
    if (asString === 'none' || asString === '(none)') return undefined;
    const m = asString.match(/\(some\s+([A-Z0-9]{1,}\.[a-zA-Z0-9\-_]+)\)/);
    if (m && m[1]) {
      const [contractAddress, contractName] = m[1].split('.');
      return { contractAddress, contractName };
    }
    const j: any = cvToJSON(cv);
    if (j?.type === 'some' && j?.value) {
      const inner = j.value;
      const contractAddress = inner.address ?? inner.contractAddress;
      const contractName = inner.contractName ?? inner.name;
      if (contractAddress && contractName) return { contractAddress, contractName };
    }
    throw new Error(`Unexpected optional contract-principal shape: ${asString}`);
  }

  decodeOptionalSubscriptionTuple(cv: ClarityValue, idHex: string): OnChainSubscription | undefined {
    const j: any = cvToJSON(cv);
    if (j.type === 'none') return undefined;
    const t: any = j.value;
    const merchant = String(t['merchant']);
    const subscriber = String(t['subscriber']);
    const amountSats = BigInt(t['amount']);
    const intervalBlocks = BigInt(t['interval']);
    const active = Boolean(t['active']);
    const nextDue = BigInt(t['next-due']);
    return { idHex, merchant, subscriber, amountSats, intervalBlocks, active, nextDue };
  }
}

export default ClarityCvAdapter;
