"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContractCallBuilder = void 0;
const PostConditionsComposer_1 = require("../delegates/PostConditionsComposer");
const OptionalBuff34Encoder_1 = require("../delegates/OptionalBuff34Encoder");
const transactions_1 = require("@stacks/transactions");
class ContractCallBuilder {
    constructor(cfg, aif, pcf, codec) {
        this.cfg = cfg;
        this.aif = aif;
        this.pcf = pcf;
        this.codec = codec;
        this.pcc = new PostConditionsComposer_1.PostConditionsComposer(this.aif, this.pcf);
        this.opt34 = new OptionalBuff34Encoder_1.OptionalBuff34Encoder();
    }
    // ───────────────────────────────────────────────────────────────────────────
    // NEW: helper – resolve the configured sBTC token as a contract-principal CV
    // Tries cfg.getSbtcTokenId() or cfg.getTokenContractId(); falls back to env.
    // Throws with a clear message if the token is not configured.
    // ───────────────────────────────────────────────────────────────────────────
    // private tokenContractCv() {
    //   // Try config service first (optional to keep this a non-breaking change)
    //   const anyCfg = this.cfg as unknown as {
    //     getSbtcTokenId?: () => { contractAddress: string; contractName: string } | { address: string; name: string };
    //     getTokenContractId?: () => { contractAddress: string; contractName: string } | { address: string; name: string };
    //   };
    //   let contractAddress: string | undefined =
    //     process.env.SBTC_CONTRACT_ADDRESS || process.env.SBTC_ADDRESS || undefined;
    //   let contractName: string | undefined =
    //     process.env.SBTC_CONTRACT_NAME || process.env.SBTC_NAME || undefined;
    //   if (anyCfg?.getSbtcTokenId) {
    //     const x = anyCfg.getSbtcTokenId();
    //     contractAddress = (x as any).contractAddress ?? (x as any).address ?? contractAddress;
    //     contractName    = (x as any).contractName    ?? (x as any).name    ?? contractName;
    //   } else if (anyCfg?.getTokenContractId) {
    //     const x = anyCfg.getTokenContractId();
    //     contractAddress = (x as any).contractAddress ?? (x as any).address ?? contractAddress;
    //     contractName    = (x as any).contractName    ?? (x as any).name    ?? contractName;
    //   }
    //   if (!contractAddress || !contractName) {
    //     throw new Error(
    //       'sBTC token not configured: missing contract address/name (provide via ConfigService or SBTC_CONTRACT_ADDRESS/SBTC_CONTRACT_NAME env)'
    //     );
    //   }
    //   return contractPrincipalCV(contractAddress, contractName);
    // }
    tokenContractCv() {
        const contractAddress = process.env.SBTC_CONTRACT_ADDRESS ?? process.env.SBTC_ADDRESS ?? '';
        const contractName = process.env.SBTC_CONTRACT_NAME ?? process.env.SBTC_NAME ?? '';
        if (!contractAddress || !contractName) {
            throw new Error('sBTC token not configured: set SBTC_CONTRACT_ADDRESS and SBTC_CONTRACT_NAME');
        }
        return (0, transactions_1.contractPrincipalCV)(contractAddress, contractName);
    }
    buildCreateInvoice(args) {
        this.codec.assertHex64(args.idHex);
        this.assertPositiveInt(args.amountSats, 'amountSats');
        if (args.expiresAtBlock !== undefined) {
            this.assertNonNegativeInt(args.expiresAtBlock, 'expiresAtBlock');
        }
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const memoOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.memo);
        const functionArgs = [
            (0, transactions_1.bufferCV)(idBuf),
            (0, transactions_1.uintCV)(args.amountSats),
            memoOpt,
            args.expiresAtBlock !== undefined ? (0, transactions_1.someCV)((0, transactions_1.uintCV)(args.expiresAtBlock)) : (0, transactions_1.noneCV)(),
        ];
        return this.baseCall('create-invoice', functionArgs);
    }
    buildRefundInvoice(args) {
        this.codec.assertHex64(args.idHex);
        this.assertPositiveInt(args.amountSats, 'amountSats');
        // principal validation by CV construction
        void (0, transactions_1.standardPrincipalCV)(args.merchantPrincipal);
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const memoOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.memo);
        const pcs = this.pcc.forRefund(args.merchantPrincipal, args.amountSats);
        // CHANGED: append trait-typed token arg (as contract principal)
        const functionArgs = [(0, transactions_1.bufferCV)(idBuf), (0, transactions_1.uintCV)(args.amountSats), memoOpt, this.tokenContractCv()];
        return this.baseCall('refund-invoice', functionArgs, pcs);
    }
    buildPayInvoice(args) {
        this.codec.assertHex64(args.idHex);
        this.assertPositiveInt(args.amountSats, 'amountSats');
        void (0, transactions_1.standardPrincipalCV)(args.payerPrincipal);
        void (0, transactions_1.standardPrincipalCV)(args.merchantPrincipal);
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const pcs = this.pcc.forPay(args.payerPrincipal, args.merchantPrincipal, args.amountSats);
        // CHANGED: add the missing ft trait arg
        const functionArgs = [(0, transactions_1.bufferCV)(idBuf), this.tokenContractCv()];
        return this.baseCall('pay-invoice', functionArgs, pcs);
    }
    buildCancelInvoice(args) {
        this.codec.assertHex64(args.idHex);
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const functionArgs = [(0, transactions_1.bufferCV)(idBuf)];
        return this.baseCall('cancel-invoice', functionArgs);
    }
    buildCreateSubscription(args) {
        this.codec.assertHex64(args.idHex);
        void (0, transactions_1.standardPrincipalCV)(args.merchant);
        void (0, transactions_1.standardPrincipalCV)(args.subscriber);
        this.assertPositiveInt(args.amountSats, 'amountSats');
        this.assertPositiveInt(args.intervalBlocks, 'intervalBlocks');
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const functionArgs = [
            (0, transactions_1.bufferCV)(idBuf),
            (0, transactions_1.standardPrincipalCV)(args.merchant),
            (0, transactions_1.standardPrincipalCV)(args.subscriber),
            (0, transactions_1.uintCV)(args.amountSats),
            (0, transactions_1.uintCV)(args.intervalBlocks),
        ];
        return this.baseCall('create-subscription', functionArgs);
    }
    buildPaySubscription(args) {
        this.codec.assertHex64(args.idHex);
        this.assertPositiveInt(args.amountSats, 'amountSats');
        void (0, transactions_1.standardPrincipalCV)(args.subscriber);
        void (0, transactions_1.standardPrincipalCV)(args.merchant);
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const pcs = this.pcc.forPay(args.subscriber, args.merchant, args.amountSats);
        // CHANGED: add the missing ft trait arg
        const functionArgs = [(0, transactions_1.bufferCV)(idBuf), this.tokenContractCv()];
        return this.baseCall('pay-subscription', functionArgs, pcs);
    }
    buildCancelSubscription(args) {
        this.codec.assertHex64(args.idHex);
        const idBuf = this.codec.toBuff32Hex(args.idHex);
        const functionArgs = [(0, transactions_1.bufferCV)(idBuf)];
        return this.baseCall('cancel-subscription', functionArgs);
    }
    buildRegisterMerchant(args) {
        const merchantCv = (0, transactions_1.standardPrincipalCV)(args.merchant);
        const nameOpt = this.opt34.encodeOptionalUtf8ToBuff34(args.name);
        const functionArgs = [merchantCv, nameOpt];
        return this.baseCall('register-merchant', functionArgs);
    }
    buildSetMerchantActive(args) {
        const merchantCv = (0, transactions_1.standardPrincipalCV)(args.merchant);
        const activeCv = args.active ? (0, transactions_1.trueCV)() : (0, transactions_1.falseCV)();
        const functionArgs = [merchantCv, activeCv];
        return this.baseCall('set-merchant-active', functionArgs);
    }
    buildSetSbtcToken(args) {
        const cp = (0, transactions_1.contractPrincipalCV)(args.contractAddress, args.contractName);
        const functionArgs = [cp];
        return this.baseCall('set-sbtc-token', functionArgs);
    }
    buildBootstrapAdmin() {
        return this.baseCall('bootstrap-admin', []);
    }
    baseCall(functionName, functionArgs, pcs) {
        const { contractAddress, contractName } = this.cfg.getContractId();
        const base = {
            contractAddress,
            contractName,
            functionName,
            functionArgs,
            network: this.cfg.getNetwork(),
            anchorMode: 'any',
        };
        if (pcs) {
            base.postConditionMode = pcs.postConditionMode;
            base.postConditions = pcs.postConditions;
        }
        return base;
    }
    assertPositiveInt(n, name) {
        if (!Number.isInteger(n) || n <= 0) {
            throw new TypeError(`${name} must be a positive integer`);
        }
    }
    assertNonNegativeInt(n, name) {
        if (!Number.isInteger(n) || n < 0) {
            throw new TypeError(`${name} must be a non-negative integer`);
        }
    }
}
exports.ContractCallBuilder = ContractCallBuilder;
//# sourceMappingURL=ContractCallBuilder.js.map