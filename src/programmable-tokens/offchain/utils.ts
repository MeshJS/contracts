import cbor from "cbor";

import subStandardPlutusScriptFreeze from "../aiken-workspace-subStandard/freeze-and-seize/plutus.json";
import subStandardPlutusScriptDummy from "../aiken-workspace-subStandard/dummy/plutus.json";
import standardPlutusScript from "../aiken-workspace-standard/plutus.json";
import { BlacklistBootstrap, BlacklistDatum, RegistryDatum } from "./type";
import {
  buildBaseAddress,
  CredentialType,
  deserializeAddress,
  Hash28ByteBase16,
} from "@meshsdk/core-cst";
import { StandardScripts } from "./common";
import { ProtocolBootstrapParams } from "./type";
import {
  deserializeDatum,
  IFetcher,
  ISubmitter,
  IWallet,
  MeshTxBuilder,
  TxInput,
  UTxO,
} from "@meshsdk/core";
import { SubStandardScripts } from "./common";

export const findValidator = (
  validatorName: string,
  isStandard: boolean = true,
): string => {
  const sources = isStandard
    ? [standardPlutusScript]
    : [subStandardPlutusScriptFreeze, subStandardPlutusScriptDummy];

  for (const script of sources) {
    const match = script.validators.find(
      ({ title }) => title === validatorName,
    );
    if (match) return match.compiledCode;
  }

  throw new Error(`Validator ${validatorName} not found`);
};

export const cborEncode = (cbor_param: string) => {
  const _cbor = cbor.encode(Buffer.from(cbor_param, "hex")).toString("hex");
  return _cbor;
};

export const walletConfig = async (wallet: IWallet) => {
  const changeAddress = await wallet.getChangeAddress();
  const walletUtxos = await wallet.getUtxos();
  const collateral = (await wallet.getCollateral())[0];
  if (!collateral) throw new Error("No collateral available");
  if (!walletUtxos) throw new Error("Wallet is empty");
  return { changeAddress, walletUtxos, collateral };
};

export function parseRegistryDatum(datum: any): RegistryDatum | null {
  if (!datum?.fields || datum.fields.length < 5) {
    return null;
  }
  return {
    key: datum.fields[0].bytes,
    next: datum.fields[1].bytes,
    transferScriptHash: datum.fields[2].bytes,
    thirdPartyScriptHash: datum.fields[3].bytes,
    metadata: datum.fields[4].bytes,
  };
}

export function parseBlacklistDatum(datum: any): BlacklistDatum | null {
  if (!datum?.fields || datum.fields.length < 2) {
    return null;
  }
  return {
    key: datum.fields[0].bytes,
    next: datum.fields[1].bytes,
  };
}

export const getSmartWalletAddress = async (
  address: string,
  params: ProtocolBootstrapParams,
  NetworkId: 0 | 1,
) => {
  const credential = deserializeAddress(address)
    .asBase()
    ?.getStakeCredential().hash;
  if (!credential) {
    throw new Error("Credential not found");
  }
  const standardScript = new StandardScripts(NetworkId);
  const programmableLogicBase =
    await standardScript.programmableLogicBase(params);
  const baseAddress = buildBaseAddress(
    0,
    programmableLogicBase.policyId as Hash28ByteBase16,
    credential!,
    CredentialType.ScriptHash,
    CredentialType.KeyHash,
  );
  return baseAddress.toAddress().toBech32();
};

export async function buildBlacklistScripts(
  NetworkId: 0 | 1,
  txInput: TxInput,
  adminPkh: string,
) {
  const substandardScript = new SubStandardScripts(NetworkId);
  const blacklistMint = await substandardScript.blacklistMint(
    txInput,
    adminPkh,
  );
  const blacklistSpend = await substandardScript.blacklistSpend(
    blacklistMint.policyId,
  );
  return { blacklistMint, blacklistSpend };
}

export const selectProgrammableTokenUtxos = async (
  senderProgTokenUtxos: UTxO[],
  unit: string,
  amount: number,
) => {
  let selectedUtxos: UTxO[] = [];
  let selectedAmount = 0;
  for (const utxo of senderProgTokenUtxos) {
    if (selectedAmount >= amount) break;
    const tokenAsset = utxo.output.amount.find((a) => a.unit === unit);
    if (tokenAsset) {
      selectedUtxos.push(utxo);
      selectedAmount += Number(tokenAsset.quantity);
    }
  }
  const returningAmount = selectedAmount - amount;
  return { selectedUtxos, returningAmount };
};

export const isAddressBlacklisted = async (
  address: string,
  blacklistBootstrap: BlacklistBootstrap,
  NetworkId: 0 | 1,
  fetcher: IFetcher,
): Promise<boolean> => {
  const stakeCredential = deserializeAddress(address)
    .asBase()
    ?.getStakeCredential().hash;

  if (!stakeCredential) return false;

  const { blacklistSpend } = await buildBlacklistScripts(
    NetworkId,
    blacklistBootstrap.blacklistMintBootstrap.txInput,
    blacklistBootstrap.blacklistMintBootstrap.adminPubKeyHash,
  );

  const blacklistUtxos = await fetcher.fetchAddressUTxOs(
    blacklistSpend.address,
  );

  return blacklistUtxos.some((utxo: UTxO) => {
    if (!utxo.output.plutusData) return false;
    const datum = parseBlacklistDatum(deserializeDatum(utxo.output.plutusData));
    return datum?.key === stakeCredential;
  });
};

export async function splitWallet(
  wallet: IWallet,
  networkId: 0 | 1,
  fetcher: IFetcher,
): Promise<string> {
  const changeAddress = await wallet.getChangeAddress();
  const walletUtxos = await wallet.getUtxos();
  const txBuilder = new MeshTxBuilder({
    fetcher: fetcher,
  });

  const unsignedTx = await txBuilder
    .selectUtxosFrom(walletUtxos)
    .txOut(changeAddress, [{ unit: "lovelace", quantity: "5000000" }])
    .txOut(changeAddress, [{ unit: "lovelace", quantity: "5000000" }])
    .changeAddress(changeAddress)
    .setNetwork(networkId === 0 ? "preview" : "mainnet")
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);
  const txHash = await wallet.submitTx(signedTx);
  if (!txHash) throw new Error("Failed to split wallet");
  return txHash;
}

export async function waitForUtxosWithTimeout(
  txHash: string,
  fetcher: IFetcher,
  timeoutMs = 150_000,
  intervalMs = 30_000,
): Promise<UTxO[]> {
  const start = Date.now();
  console.log(
    "Kindly wait for approx. 5 minutes for utxo split and transaction confirmed onchain",
  );
  while (Date.now() - start < timeoutMs) {
    let utxos: UTxO[] | undefined;
    try {
      utxos = await fetcher.fetchUTxOs(txHash);
    } catch {
      utxos = undefined;
    }

    if (Array.isArray(utxos) && utxos.length > 0) {
      return utxos;
    }

    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }

  throw new Error(
    `Timed out after ${timeoutMs / 1000}s waiting for UTxOs from tx ${txHash}`,
  );
}
