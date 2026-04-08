import cbor from "cbor";
import subStandardPlutusScriptFreeze from "../aiken-workspace-subStandard/freeze-and-seize/plutus.json";
import subStandardPlutusScriptDummy from "../aiken-workspace-subStandard/dummy/plutus.json";
import standardPlutusScript from "../aiken-workspace-standard/plutus.json";
import {
  BlacklistBootstrap,
  BlacklistDatum,
  RegistryCredential,
  RegistryDatum,
} from "./type";
import {
  deserializeAddress,
} from "@meshsdk/core-cst";
import {
  deserializeDatum,
  IFetcher,
  IWallet,
  UTxO,
} from "@meshsdk/core";
import { resolveBlacklistScripts } from "./resolvers";

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

function extractBytes(field: any): string {
  if (!field) return "";
  if (typeof field === "string") return field;
  if (field.bytes) return field.bytes;
  if (field.fields && field.fields.length > 0) {
    const inner = field.fields[0];
    if (typeof inner === "string") return inner;
    if (inner?.bytes) return inner.bytes;
  }
  return "";
}

export function parseRegistryDatum(datum: any): RegistryDatum | null {
  if (!datum?.fields || datum.fields.length < 5) {
    return null;
  }

  const getCredential = (field: any): RegistryCredential => {
    return {
      hash: extractBytes(field),
      index: field.constructor ?? 0,
    };
  };

  return {
    key: extractBytes(datum.fields[0]),
    next: extractBytes(datum.fields[1]),
    transferScript: getCredential(datum.fields[2]),
    thirdPartyScript: getCredential(datum.fields[3]),
    metadata: extractBytes(datum.fields[4]),
  };
}

export function parseBlacklistDatum(datum: any): BlacklistDatum | null {
  if (!datum?.fields || datum.fields.length < 2) {
    return null;
  }
  return {
    key: extractBytes(datum.fields[0]),
    next: extractBytes(datum.fields[1]),
  };
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

  const { blacklistSpend } = await resolveBlacklistScripts(
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
