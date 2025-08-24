// src/factories/PostConditionFactory.ts
import { IPostConditionFactory } from '../contracts/interfaces';
import {
  createAssetInfo,
  FungibleConditionCode,
  makeStandardFungiblePostCondition,
  PostConditionPrincipal,
} from '@stacks/transactions';

export class PostConditionFactory implements IPostConditionFactory {
  forPayInvoice(payer: string, merchant: string, amountSats: number, asset: any): any[] {
    if (typeof payer !== 'string' || payer.length === 0) {
      throw new Error('invalid_payer_principal');
    }
    if (typeof merchant !== 'string' || merchant.length === 0) {
      throw new Error('invalid_merchant_principal');
    }
    if (typeof asset?.contractAddress !== 'string' || asset.contractAddress.length === 0) {
      throw new Error('invalid_contract_address');
    }
    if (typeof asset?.contractName !== 'string' || asset.contractName.length === 0) {
      throw new Error('invalid_contract_name');
    }
    if (typeof asset?.assetName !== 'string' || asset.assetName.length === 0) {
      throw new Error('invalid_asset_name');
    }
    const amt = BigInt(amountSats);
    if (amt <= 0n) {
      throw new Error('invalid_amount');
    }

    const assetInfo = createAssetInfo(asset.contractAddress, asset.contractName, asset.assetName);

    // Use the payer principal directly as the principal for the payer-sent post-condition.
    const payerSentGe = makeStandardFungiblePostCondition(
      payer,
      FungibleConditionCode.GreaterEqual,
      amt,
      assetInfo,
    );

    const merchantReceivedGe = makeStandardFungiblePostCondition(
      merchant,
      FungibleConditionCode.GreaterEqual,
      amt,
      assetInfo,
    );

    return [payerSentGe, merchantReceivedGe];
  }

  forRefund(merchant: string, amountSats: number, asset: any): any[] {
    if (typeof merchant !== 'string' || merchant.length === 0) {
      throw new Error('invalid_merchant_principal');
    }
    if (typeof asset?.contractAddress !== 'string' || asset.contractAddress.length === 0) {
      throw new Error('invalid_contract_address');
    }
    if (typeof asset?.contractName !== 'string' || asset.contractName.length === 0) {
      throw new Error('invalid_contract_name');
    }
    if (typeof asset?.assetName !== 'string' || asset.assetName.length === 0) {
      throw new Error('invalid_asset_name');
    }
    const amt = BigInt(amountSats);
    if (amt <= 0n) {
      throw new Error('invalid_amount');
    }

    const assetInfo = createAssetInfo(asset.contractAddress, asset.contractName, asset.assetName);

    const capOutflowPc = makeStandardFungiblePostCondition(
      merchant,
      FungibleConditionCode.LessEqual,
      amt,
      assetInfo,
    );

    return [capOutflowPc];
  }
}

export default PostConditionFactory;
