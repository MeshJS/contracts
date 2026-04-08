import {
  byteString,
  conStr,
  conStr1,
  integer,
  PlutusScript,
  TxInput,
} from "@meshsdk/common";
import {
  applyParamsToScript,
  resolveScriptHash,
  serializePlutusScript,
} from "@meshsdk/core";
import { scriptHashToRewardAddress } from "@meshsdk/core-cst";

import { ProtocolBootstrapParams } from "./type";
import { cborEncode, findValidator } from "./utils";

export class StandardScripts {
  constructor(private readonly networkID: number) {}

  private build(
    validatorName: string,
    params: object[],
  ): { cbor: string; plutusScript: PlutusScript } {
    const cbor = applyParamsToScript(
      findValidator(validatorName),
      params,
      "JSON",
    );
    return { cbor, plutusScript: { code: cbor, version: "V3" } };
  }

  private txRef(utxo: TxInput) {
    return conStr(0, [byteString(utxo.txHash), integer(utxo.outputIndex)]);
  }

  private resolveParam(
    params: ProtocolBootstrapParams | string,
    extract: (p: ProtocolBootstrapParams) => string,
    errorMsg: string,
  ): string {
    const hash = typeof params === "string" ? params : extract(params);
    if (!hash) throw new Error(errorMsg);
    return hash;
  }

  private toAddress(
    plutusScript: PlutusScript,
    staking: string | undefined = undefined,
  ) {
    return serializePlutusScript(plutusScript, staking, this.networkID, false)
      .address;
  }

  async issuanceMint(
    mintingLogicCredential: string,
    params: ProtocolBootstrapParams | string,
  ) {
    const paramScriptHash = this.resolveParam(
      params,
      (p) => p.programmableLogicBaseParams.scriptHash!,
      "could not resolve issuance mint parameters",
    );
    const { cbor, plutusScript } = this.build(
      "issuance_mint.issuance_mint.mint",
      [
        conStr1([byteString(paramScriptHash)]),
        conStr1([byteString(mintingLogicCredential)]),
      ],
    );
    return {
      cbor,
      plutusScript,
      policyId: resolveScriptHash(cbor, "V3"),
      address: this.toAddress(plutusScript),
    };
  }

  async issuanceCborHexMint(utxo_reference: TxInput) {
    const { cbor, plutusScript } = this.build(
      "issuance_cbor_hex_mint.issuance_cbor_hex_mint.mint",
      [this.txRef(utxo_reference)],
    );
    return {
      cbor,
      plutusScript,
      policyId: resolveScriptHash(cbor, "V3"),
      address: this.toAddress(plutusScript),
    };
  }

  async programmableLogicBase(params: ProtocolBootstrapParams | string) {
    const paramScriptHash = this.resolveParam(
      params,
      (p) => p.programmableLogicGlobalPrams.scriptHash!,
      "could not resolve logic base parameter",
    );
    const { cbor, plutusScript } = this.build(
      "programmable_logic_base.programmable_logic_base.spend",
      [conStr1([byteString(paramScriptHash)])],
    );
    return { cbor, plutusScript, policyId: resolveScriptHash(cbor, "V3") };
  }

  async programmableLogicGlobal(params: ProtocolBootstrapParams | string) {
    const paramScriptHash = this.resolveParam(
      params,
      (p) => p.protocolParams.scriptHash!,
      "could not resolve logic global parameter",
    );
    const { cbor, plutusScript } = this.build(
      "programmable_logic_global.programmable_logic_global.withdraw",
      [byteString(paramScriptHash)],
    );
    const scriptHash = resolveScriptHash(cbor, "V3");
    return {
      cbor,
      plutusScript,
      scriptHash,
      rewardAddress: scriptHashToRewardAddress(scriptHash, this.networkID),
    };
  }

  async protocolParamMint(utxo_reference: TxInput) {
    const { cbor, plutusScript } = this.build(
      "protocol_params_mint.protocol_params_mint.mint",
      [this.txRef(utxo_reference)],
    );
    const scriptHash = resolveScriptHash(cbor, "V3");
    return {
      cbor,
      plutusScript,
      scriptHash,
      address: this.toAddress(plutusScript),
    };
  }

  async registryMint(params: ProtocolBootstrapParams | string, utxo?: TxInput) {
    const paramScriptHash =
      typeof params === "string"
        ? params
        : params.directoryMintParams.issuanceScriptHash;
    const txInput =
      typeof params === "string" ? utxo! : params.directoryMintParams.txInput;
    if (!txInput)
      throw new Error("register mint utxo parameter could not resolve");
    if (!paramScriptHash)
      throw new Error("registry mint param script hash could not resolve");
    const { cbor, plutusScript } = this.build(
      "registry_mint.registry_mint.mint",
      [this.txRef(txInput), byteString(paramScriptHash)],
    );
    return { cbor, plutusScript, policyId: resolveScriptHash(cbor, "V3") };
  }

  async registrySpend(params: ProtocolBootstrapParams | string) {
    const paramScriptHash = this.resolveParam(
      params,
      (p) => p.protocolParams.scriptHash,
      "could not resolve params for registry spend",
    );
    const { cbor, plutusScript } = this.build(
      "registry_spend.registry_spend.spend",
      [byteString(paramScriptHash)],
    );
    return {
      cbor,
      plutusScript,
      policyId: resolveScriptHash(cbor, "V3"),
      address: this.toAddress(plutusScript, ""),
    };
  }
}

export class SubStandardScripts {
  constructor(private readonly networkID: number) {}

  private buildRaw(validatorName: string) {
    const _cbor = cborEncode(findValidator(validatorName, false));
    const plutusScript: PlutusScript = { code: _cbor, version: "V3" };
    const policyId = resolveScriptHash(_cbor, "V3");
    const rewardAddress = scriptHashToRewardAddress(policyId, this.networkID);
    return { _cbor, plutusScript, policyId, rewardAddress };
  }

  private buildWithParams(validatorName: string, params: object[]) {
    const _cbor = findValidator(validatorName, false);
    const cbor = applyParamsToScript(_cbor, params, "JSON");
    const plutusScript: PlutusScript = { code: cbor, version: "V3" };
    const policyId = resolveScriptHash(cbor, "V3");
    const rewardAddress = scriptHashToRewardAddress(policyId, this.networkID);
    return { cbor, plutusScript, policyId, rewardAddress };
  }

  private txRef(utxo: TxInput) {
    return conStr(0, [byteString(utxo.txHash), integer(utxo.outputIndex)]);
  }

  async issue() {
    return this.buildRaw("transfer.issue.withdraw");
  }

  async transfer() {
    return this.buildRaw("transfer.transfer.withdraw");
  }

  async blacklistSpend(blacklistNodePolicyId: string) {
    const { cbor, plutusScript, policyId } = this.buildWithParams(
      "blacklist_spend.blacklist_spend.spend",
      [byteString(blacklistNodePolicyId)],
    );
    const address = serializePlutusScript(
      plutusScript,
      "",
      this.networkID,
      false,
    ).address;
    return { cbor, plutusScript, address, policyId };
  }

  async blacklistMint(bootstraptxInput: TxInput, adminPubkeyHash: string) {
    return this.buildWithParams("blacklist_mint.blacklist_mint.mint", [
      this.txRef(bootstraptxInput),
      byteString(adminPubkeyHash),
    ]);
  }

  async issuerAdmin(adminPubKeyHash: string) {
    return this.buildWithParams(
      "example_transfer_logic.issuer_admin_contract.withdraw",
      [conStr(0, [byteString(adminPubKeyHash)])],
    );
  }

  async customTransfer(
    programmableLogicBaseScriptHash: string,
    blacklistNodePolicyId: string,
  ) {
    const { cbor, plutusScript, policyId, rewardAddress } =
      this.buildWithParams("example_transfer_logic.transfer.withdraw", [
        conStr1([byteString(programmableLogicBaseScriptHash)]),
        byteString(blacklistNodePolicyId),
      ]);
    return { cbor, plutusScript, policyId, rewardAddress };
  }
}
