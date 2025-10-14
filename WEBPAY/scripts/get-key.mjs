#!/usr/bin/env node
// Usage:
//   node get-key.mjs --mnemonic "your seed phrase ..." --address ST1... [--max 100]
// Notes:
//   - Auto-detects network from prefix: ST -> Testnet/Simnet (txVersion=0), SP -> Mainnet (txVersion=1)
//   - Scans indices 0..N using deriveAccount()
// Works with @stacks/wallet-sdk@7.2.x and @stacks/transactions@7.2.x.

// import { decryptMnemonic } from '@stacks/encryption';
// import { generateWallet, generateNewAccount, getStxAddress } from '@stacks/wallet-sdk';

// function arg(name, short) {
//   const a = process.argv;
//   let i = a.indexOf(name);
//   if (i > -1 && a[i + 1]) return a[i + 1];
//   if (short) { i = a.indexOf(short); if (i > -1 && a[i + 1]) return a[i + 1]; }
//   return undefined;
// }

// const encrypted = arg('--encrypted', '-e');  // the hex string from your wallet JSON: encryptedSecretKey
// const password  = "This$hit$uck$$oBad";  // Leather wallet password
// const target    = arg('--address',   '-a');  // ST... or SP...
// const max       = Number(arg('--max') || 200);

// if (!encrypted || !password || !target) {
//   console.error('Usage: node scripts/get-stx-key-from-encrypted.mjs --encrypted "<hex>" --password "<pwd>" --address ST|SP... [--max N]');
//   process.exit(1);
// }

// const txVersion =
//   target.startsWith('SP') ? 1 :
//   target.startsWith('ST') ? 0 :
//   (() => { console.error('Address must start with ST (testnet/simnet) or SP (mainnet)'); process.exit(1); })();

// (async () => {
//   try {
//     // 1) decrypt Leather’s encryptedSecretKey → mnemonic
//     const mnemonic = await decryptMnemonic(encrypted, password);

//     // 2) rebuild wallet from mnemonic; validate phrase
//     let wallet = await generateWallet({ secretKey: mnemonic, password: '' });

//     // 3) scan accounts 0..max until address matches
//     for (let i = 0; i <= max; i++) {
//       if (!wallet.accounts[i]) wallet = generateNewAccount(wallet);
//       const account = wallet.accounts[i];
//       const addr = getStxAddress({ account, transactionVersion: txVersion });
//       if (addr === target) {
//         console.log(account.stxPrivateKey);
//         process.exit(0);
//       }
//     }

//     console.error(`Address not found in indices 0..${max}. Increase --max or verify you used the correct wallet/password.`);
//     process.exit(2);
//   } catch (e) {
//     console.error('Error:', e?.message || e);
//     process.exit(3);
//   }
// })();


import { generateWallet, generateNewAccount, getStxAddress, deriveStxPrivateKey } from '@stacks/wallet-sdk';
// import { getStxAddress, TransactionVersion } from '@stacks/transactions';

const mnemonic = "repeat beyond army section arrange fix letter author behind exotic bitter merge oblige wheat stuff genius clarify license insect payment swear venue grit myself";
const network = "testnet"; // or "mainnet"
const maxAccounts = 10;

const wallet = await generateWallet({ secretKey: mnemonic, password: '' });
const stxPrivateKey = wallet.accounts[0].stxPrivateKey;
const stxAddress = getStxAddress({
    transactionVersion: 'Testnet', // Use `Mainnet` for production
    stxPrivateKey: stxPrivateKey,
});
console.log("Mnemonic:       ", wallet.secretKey);
console.log("STX Private Key:", stxPrivateKey);
console.log("STX Address:    ", stxAddress);

