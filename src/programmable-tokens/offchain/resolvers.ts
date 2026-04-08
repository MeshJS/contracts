import {
  deserializeAddress,
  buildBaseAddress,
  CredentialType,
  Hash28ByteBase16,
} from "@meshsdk/core-cst";
import { StandardScripts, SubStandardScripts } from "./common";
import { smartWalletAddress, stakeCredential } from "./type";
import params from "./protocolParams.json";
import { TxInput } from "@meshsdk/common";

/**
 * Resolves the programmable smart wallet address for a given base address.
 */
export const resolveSmartWalletAddress = async (
  address: string,
  networkId: 0 | 1,
): Promise<smartWalletAddress> => {
  const credential = deserializeAddress(address)
    .asBase()
    ?.getStakeCredential().hash;

  if (!credential) {
    throw new Error("Address missing stake credential");
  }

  const standardScript = new StandardScripts(networkId);
  const programmableLogicBase =
    await standardScript.programmableLogicBase(params);

  const baseAddress = buildBaseAddress(
    networkId,
    programmableLogicBase.policyId as Hash28ByteBase16,
    credential,
    CredentialType.ScriptHash,
    CredentialType.KeyHash,
  );

  return baseAddress.toAddress().toBech32() as smartWalletAddress;
};

/**
 * Resolves the stake credential hash from a bech32 address.
 */
export const resolveStakeCredential = (address: string): stakeCredential => {
  const cred = deserializeAddress(address).asBase()?.getStakeCredential().hash;
  if (!cred) throw new Error("Address missing stake credential");
  return cred as stakeCredential;
};

/**
 * Resolves the blacklist mint and spend scripts.
 */
export async function resolveBlacklistScripts(
  networkId: 0 | 1,
  blacklistMintBootstrapTxInput: TxInput,
  blacklistAdminPkh: string,
) {
  const substandardScript = new SubStandardScripts(networkId);
  const blacklistMint = await substandardScript.blacklistMint(
    blacklistMintBootstrapTxInput,
    blacklistAdminPkh,
  );
  const blacklistSpend = await substandardScript.blacklistSpend(
    blacklistMint.policyId,
  );
  return { blacklistMint, blacklistSpend };
}

/**
 * Resolves the blacklist script address.
 */
export const resolveBlacklistAddress = async (
  blacklistMintScriptHash: string,
  networkId: number,
): Promise<string> => {
  const substandard = new SubStandardScripts(networkId);
  const blacklistSpend = await substandard.blacklistSpend(
    blacklistMintScriptHash,
  );
  return blacklistSpend.address;
};
