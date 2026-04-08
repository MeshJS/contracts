import { PlutusScript } from "@meshsdk/common";

export type smartWalletAddress = string;

export type stakeCredential = string;

export type BlacklistDatum = {
  key: string;
  next: string;
};

export type RegistryCredential = {
  hash: string;
  index: number;
};

export type RegistryDatum = {
  key: string;
  next: string;
  transferScript: RegistryCredential;
  thirdPartyScript: RegistryCredential;
  metadata: string;
};

export type TxInput = {
  txHash: string;
  outputIndex: number;
};

export type ProtocolParams = {
  txInput: TxInput;
  scriptHash: string;
  alwaysFailScriptHash: string;
};

export type ProgrammableLogicGlobalParams = {
  protocolParamsScriptHash: string;
  scriptHash: string;
};

export type ProgrammableLogicBaseParams = {
  programmableLogicGlobalScriptHash: string;
  scriptHash: string;
};

export type IssuanceParams = {
  txInput: TxInput;
  scriptHash: string;
  alwaysFailScriptHash: string;
};

export type DirectoryMintParams = {
  txInput: TxInput;
  issuanceScriptHash: string;
  scriptHash: string;
};

export type DirectorySpendParams = {
  protocolParamsPolicyId: string;
  scriptHash: string;
};

export type BlacklistMintBootstrap = {
  txInput: TxInput;
  adminPubKeyHash: string;
  scriptHash: string;
};

export type BlacklistSpendBootstrap = {
  blacklistMintScriptHash: string;
  scriptHash: string;
};

export type BlacklistBootstrap = {
  blacklistMintBootstrap: BlacklistMintBootstrap;
  blacklistSpendBootstrap: BlacklistSpendBootstrap;
};

export type ProtocolBootstrapParams = {
  protocolParams: ProtocolParams;
  programmableLogicGlobalPrams: ProgrammableLogicGlobalParams;
  programmableLogicBaseParams: ProgrammableLogicBaseParams;
  issuanceParams: IssuanceParams;
  directoryMintParams: DirectoryMintParams;
  directorySpendParams: DirectorySpendParams;
  programmableBaseRefInput: TxInput;
  programmableGlobalRefInput: TxInput;
  txHash: string;
};

export type TokenScripts = {
  mintingLogic: PlutusScript;
  transferLogic: PlutusScript;
  globalStateLogic?: PlutusScript;
  thirdPartyLogic?: PlutusScript;
};

export type RegisterTokenParams = {
  assetName: string;
  scripts: TokenScripts;
  transferRedeemerValue: any;
  recipientAddress?: string;
};

export type MintTokensParams = {
  assetName: string;
  scripts: {
    mintingLogic: PlutusScript;
    transferLogic: PlutusScript;
  };
  transferRedeemerValue: any;
  recipientAddress?: string | null;
};

export type TransferTokenParams = {
  unit: string;
  quantity: string;
  recipientAddress: string;
  transferLogic: PlutusScript;
  transferRedeemerValue: any;
};
