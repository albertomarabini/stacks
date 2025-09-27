// src/factories/PostConditionFactory.ts
import { Pc } from '@stacks/transactions';
import { IPostConditionFactory } from '../contracts/interfaces';

type FtAsset = {
  contractAddress: string; // e.g. 'ST...'
  contractName: string;    // e.g. 'sbtc-token'
  assetName: string;       // e.g. 'sbtc'
};

// Stacks v7 Pc.ft expects a template-literal ContractId: `${string}.${string}`
type ContractId = `${string}.${string}`;

export class PostConditionFactory implements IPostConditionFactory {
  /**
   * Build post-conditions for paying an invoice.
   * NOTE: Post-conditions constrain the *sender* only. Recipient guarantees are enforced in Clarity.
   */
  forPayInvoice(payer: string, merchant: string, amountSats: number, asset: FtAsset): any[] {
    if (typeof payer !== 'string' || payer.length === 0) throw new Error('invalid_payer_principal');
    if (typeof merchant !== 'string' || merchant.length === 0) throw new Error('invalid_merchant_principal');
    if (typeof asset?.contractAddress !== 'string' || asset.contractAddress.length === 0) throw new Error('invalid_contract_address');
    if (typeof asset?.contractName !== 'string' || asset.contractName.length === 0) throw new Error('invalid_contract_name');
    if (typeof asset?.assetName !== 'string' || asset.assetName.length === 0) throw new Error('invalid_asset_name');

    const amt = BigInt(amountSats);
    if (amt <= 0n) throw new Error('invalid_amount');

    const contractId: ContractId = `${asset.contractAddress}.${asset.contractName}`;

    // Payer must send >= amount of the FT (sBTC)
    const payerSendsGte = Pc.principal(payer).willSendGte(amt).ft(contractId, asset.assetName);
    // extra guard: merchant does not send any sBTC in this tx
    const merchantSendsLte0 = Pc.principal(merchant).willSendLte(0n).ft(contractId, asset.assetName);

    return [payerSendsGte, merchantSendsLte0];
  }

  /**
   * Build post-conditions for a refund (cap merchant outflow).
   */
  forRefund(merchant: string, amountSats: number, asset: FtAsset): any[] {
    if (typeof merchant !== 'string' || merchant.length === 0) throw new Error('invalid_merchant_principal');
    if (typeof asset?.contractAddress !== 'string' || asset.contractAddress.length === 0) throw new Error('invalid_contract_address');
    if (typeof asset?.contractName !== 'string' || asset.contractName.length === 0) throw new Error('invalid_contract_name');
    if (typeof asset?.assetName !== 'string' || asset.assetName.length === 0) throw new Error('invalid_asset_name');

    const amt = BigInt(amountSats);
    if (amt <= 0n) throw new Error('invalid_amount');

    const contractId: ContractId = `${asset.contractAddress}.${asset.contractName}`;

    // Merchant will send <= amount of the FT (sBTC)
    const capOutflow = Pc.principal(merchant).willSendLte(amt).ft(contractId, asset.assetName);

    return [capOutflow];
  }
}

export default PostConditionFactory;
