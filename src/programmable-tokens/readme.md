# Mesh CIP-113 Programmable Token Contract

A TypeScript/React SDK for managing programmable tokens on Cardano, implementing [CIP-113](https://github.com/cardano-foundation/CIPs/pull/638). Built on [Mesh](https://meshjs.dev/).

---

## What Are Programmable Tokens?

Programmable tokens extend standard Cardano native assets with on-chain transfer logic enforced by Plutus V3 smart contracts. Key differences from regular Cardano tokens:

- **Held in smart wallets, not regular wallets.** Tokens live at a script-controlled address derived from the user's stake credential and the `programmableLogicBase` script.
- **Every transfer is validated on-chain.** Spending requires the `programmableLogicGlobal` withdrawal validator to run, which checks compliance rules (e.g. blacklists, registry membership) before allowing movement.
- **Issuance is permissioned.** Minting requires an issuer admin signature which was used to instantiate the blacklist param arbitrary wallets cannot freely mint.
- **Tokens can be seized.** An issuer admin can forcibly move tokens from any smart wallet, which is not possible with standard native assets.
- **Blacklisting is enforced at the protocol level.** Blacklisted stake credentials cannot be used as a spending input, blocking transfers at the validator level rather than in application logic.

---

## Installation

```bash
npm install @meshsdk/core @meshsdk/react @meshsdk/contract
```

---

## Protocol Parameters

Protocol parameters are **bundled into the library** as we are expected to follow a general or param deployment for every programmable token lifecycle and loaded automatically from `protocolParams.json`. No manual configuration needed. Inspect them via the `protocolParams` getter on the contract instance if needed.

---

## Blacklist Bootstrap

Each issuer deploys their own blacklist. You either deploy a fresh one via [`initializeBlacklist()`](#initializeblacklist) or load an existing one from storage.

```typescript
// blacklist.json (save this after initializeBlacklist and commit/store it)
{
  "blacklistMintBootstrap": {
    "txInput": { "txHash": "...", "outputIndex": 2 },
    "adminPubKeyHash": "...",
    "scriptHash": "..."
  },
  "blacklistSpendBootstrap": {
    "blacklistMintScriptHash": "...",
    "scriptHash": "..."
  }
}
```

> The blacklist minting policy is derived from `txInput` + `adminPubKeyHash` — making each issuer's blacklist unique. Do not lose this file.

---

## Setup

### Provider & Contract Factory

```typescript
// lib/provider.ts
import { BlockfrostProvider } from "@meshsdk/core";
export default new BlockfrostProvider("YOUR_BLOCKFROST_KEY");
```

```typescript
// lib/contract.ts
import { MeshTxBuilder, IWallet } from "@meshsdk/core";
import { ProgrammableTokenContract, BlacklistBootstrap } from "@meshsdk/contract";
import blacklistData from "./blacklist.json";
import provider from "./provider";

export const getContract = (wallet?: IWallet) =>
  new ProgrammableTokenContract(
    {
      mesh: new MeshTxBuilder({ fetcher: provider, submitter: provider, evaluator: provider }),
      fetcher: provider,
      wallet,
      networkId: 0, // 0 = preview, 1 = mainnet
    },
    blacklistData as unknown as BlacklistBootstrap,
  );
```

### Wallet Integration

Wallet signing uses the [`@meshsdk/react`](https://meshjs.dev/react) package. All transactions are **built on the backend/contract layer and signed in the browser by the connected wallet** — the contract never holds private keys.

```typescript
import { useWallet, useAddress } from "@meshsdk/react";

const { wallet, connected } = useWallet();
const address = useAddress();
```

---

## Resolver Utilities

```typescript
import { resolveSmartWalletAddress, resolveStakeCredential } from "@meshsdk/contract";
```

| Function | Description |
|---|---|
| `resolveSmartWalletAddress(address, networkId)` | Derives the smart wallet address from any Cardano base address. Use this before mint, transfer, and seize calls. |
| `resolveStakeCredential(address)` | Extracts the stake credential hash from a bech32 address. |
| `resolveBlacklistScripts(networkId, txInput, adminPkh)` | Reconstructs the blacklist mint and spend script objects. |
| `resolveBlacklistAddress(scriptHash, networkId)` | Returns the on-chain address of the blacklist spend validator. |

---

## Methods

All methods return an **unsigned transaction hex**. The frontend wallet signs and submits it.

```typescript
const txHex = await contract.someMethod(...);
const signedTx = await wallet.signTx(txHex);
const txHash = await wallet.submitTx(signedTx);
```

---

### `mintToken`

```typescript
const txHex = await contract.mintToken(
  assetName,            // string — e.g. "MyToken"
  quantity,             // string — e.g. "1000"
  issuerAdminPkh,       // string — payment PKH of the issuer admin
  recepientSmartAddress // smartWalletAddress — from resolveSmartWalletAddress()
);
```

Mints programmable tokens and sends them to the recipient's smart wallet. Requires the issuer admin to sign.

**React example:**

```tsx
import { useWallet, useAddress } from "@meshsdk/react";
import { resolveSmartWalletAddress } from "@meshsdk/contract";
import { deserializeAddress } from "@meshsdk/core";
import { getContract } from "../lib/contract";

export const MintTokens = () => {
  const { wallet, connected } = useWallet();
  const address = useAddress();

  const handleMint = async (assetName: string, quantity: string, recipientAddress: string) => {
    if (!connected || !wallet || !address) return;
    const smartAddress = await resolveSmartWalletAddress(recipientAddress || address, 0);
    const issuerAdminPkh = deserializeAddress(address).pubKeyHash;
    const txHex = await getContract(wallet).mintToken(assetName, quantity, issuerAdminPkh, smartAddress);
    const txHash = await wallet.submitTx(await wallet.signTx(txHex));
    console.log("Minted:", txHash);
  };
};
```

---

### `burnToken`

```typescript
const txHex = await contract.burnToken(
  assetName,      // string — token name (not hex)
  quantity,       // string
  txhash,         // string — tx hash of the UTxO holding the tokens
  outputIndex,    // number
  issuerAdminPkh  // string
);
```

Burns tokens from a specific UTxO. Remaining tokens and ADA are returned to the same address.

---

### `transferToken`

```typescript
const txHex = await contract.transferToken(
  unit,                 // string — policyId + stringToHex(assetName)
  quantity,             // string
  senderSmartWallet,    // smartWalletAddress — from resolveSmartWalletAddress()
  recipientSmartWallet  // smartWalletAddress — from resolveSmartWalletAddress()
);
```

Transfers tokens between smart wallets. On-chain validators verify the sender is not blacklisted and the token is registered before allowing the transaction. The sender's stake credential must sign.

> Both addresses must be **smart wallet addresses** — resolve them first with `resolveSmartWalletAddress()`.

---

### `blacklistSmartWalletAddress`

```typescript
const txHex = await contract.blacklistSmartWalletAddress(
  smartWalletAddress // smartWalletAddress
);
```

Adds a smart wallet's stake credential to the issuer's blacklist. The blacklist is an on-chain sorted linked list — inserting a node requires spending the predecessor. Requires the blacklist admin signature.

---

### `whitelistSmartWalletAddress`

```typescript
const txHex = await contract.whitelistSmartWalletAddress(
  smartWalletAddress // smartWalletAddress
);
```

Removes a stake credential from the blacklist by burning its node NFT and re-linking the list. Requires the blacklist admin signature.

---

### `seizeToken`

```typescript
const txHex = await contract.seizeToken(
  unit,                  // string — policyId + stringToHex(assetName)
  txHash,                // string — tx hash of UTxO to seize
  outputIndex,           // number
  issuerAdminPkh,        // string
  recipientSmartWallet   // smartWalletAddress — where seized tokens go
);
```

Forcibly moves tokens from any smart wallet to a target address. Non-token assets are returned to the original address. Requires the issuer admin signature and a fee-payer UTxO with at least 10 ADA.

---

### `initializeBlacklist`

```typescript
const { txHex, bootstrap } = await contract.initializeBlacklist(
  adminPubKeyHash // string — payment PKH of the blacklist admin
);
```

Deploys a new blacklist for an issuer. Requires a wallet UTxO with at least 10 ADA (ADA-only). Returns the `bootstrap` object — **persist this immediately**; it cannot be reconstructed.

**React example:**

```tsx
import { useWallet, useAddress } from "@meshsdk/react";
import { deserializeAddress } from "@meshsdk/core";
import { getContract } from "../lib/contract";

export const InitializeBlacklist = () => {
  const { wallet, connected } = useWallet();
  const address = useAddress();

  const handleInit = async () => {
    if (!connected || !wallet || !address) return;
    const adminPkh = deserializeAddress(address).pubKeyHash;
    const { txHex, bootstrap } = await getContract(wallet).initializeBlacklist(adminPkh);
    const txHash = await wallet.submitTx(await wallet.signTx(txHex));
    console.log("Blacklist deployed:", txHash);
    // ⚠️ Save bootstrap to your database or commit blacklist.json
    console.log("Bootstrap:", JSON.stringify(bootstrap, null, 2));
  };
};
```

---

## Notes

- **`unit`** is always `policyId + stringToHex(assetName)`. Use `stringToHex` from `@meshsdk/common`.
- **Smart wallet ≠ regular wallet.** A smart wallet address is derived from `programmableLogicBase` script hash + user stake credential. Tokens sent to a regular address will not be spendable by the programmable logic validators.
- **The signing wallet covers fees only.** Required signers (issuer admin, sender stake credential) are declared in the transaction — they do not need to be the fee-paying wallet.
- `networkId: 0` = preview testnet, `networkId: 1` = mainnet.
