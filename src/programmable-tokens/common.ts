import {
  byteString,
  conStr,
  conStr1,
  integer,
  PlutusScript,
  scriptHash,
  TxInput,
} from "@meshsdk/common";
import {
  applyParamsToScript,
  resolveScriptHash,
  serializePlutusScript,
} from "@meshsdk/core";
import { scriptHashToRewardAddress } from "@meshsdk/core-cst";

import { ProtocolBootstrapParams } from "./types";
import { findValidator } from "./utils";

export class Cip113_scripts_standard {
  private networkId: number;
  constructor(networkId: number) {
    this.networkId = networkId;
  }
  async blacklist_mint(utxoReference: TxInput, managerPubkeyHash: string) {
    const validator = findValidator("blacklist_mint", "mint");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(utxoReference.txHash),
          integer(utxoReference.outputIndex),
        ]),
        byteString(managerPubkeyHash),
      ],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");

    return { cbor, plutusScript, policyId };
  }

  async issuance_mint(
    mintingLogicCredential: string,
    params: ProtocolBootstrapParams | string
  ) {
    const validator = findValidator("issuance_mint", "mint");
    let paramScriptHash: string;
    if (typeof params === "string") {
      paramScriptHash = params;
    } else {
      paramScriptHash = params?.programmableLogicBaseParams.scriptHash!;
    }
    if (!paramScriptHash)
      throw new Error("could not resolve issuance mint parameters");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr1([byteString(paramScriptHash)]),
        conStr1([byteString(mintingLogicCredential)]),
      ],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");
    const address = serializePlutusScript(
      plutusScript,
      undefined,
      this.networkId,
      false
    ).address;
    return { cbor, plutusScript, policyId, address };
  }

  async issuance_cbor_hex_mint(utxoReference: TxInput) {
    const validator = findValidator("issuance_cbor_hex_mint", "mint");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(utxoReference.txHash),
          integer(utxoReference.outputIndex),
        ]),
      ],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");
    const address = serializePlutusScript(
      plutusScript,
      undefined,
      this.networkId,
      false
    ).address;
    return { cbor, plutusScript, policyId, address };
  }

  async programmable_logic_base(params: ProtocolBootstrapParams | string) {
    const validator = findValidator("programmable_logic_base", "spend");
    let paramScriptHash: string;
    if (typeof params === "string") {
      paramScriptHash = params;
    } else {
      paramScriptHash = params?.programmableLogicGlobalPrams.scriptHash!;
    }
    if (!paramScriptHash)
      throw new Error("could not resolve logic base parameter");
    const cbor = applyParamsToScript(
      validator,
      [conStr1([byteString(paramScriptHash)])],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");
    return {
      cbor,
      plutusScript,
      policyId,
    };
  }

  async programmable_logic_global(params: ProtocolBootstrapParams | string) {
    const validator = findValidator("programmable_logic_global", "withdraw");
    let paramScriptHash: string;
    if (typeof params === "string") {
      paramScriptHash = params;
    } else {
      paramScriptHash = params?.protocolParams.scriptHash!;
    }
    if (!paramScriptHash)
      throw new Error("could not resolve logic global parameter");
    const cbor = applyParamsToScript(
      validator,
      [scriptHash(paramScriptHash)],
      "JSON"
    );
    const policyId = resolveScriptHash(cbor, "V3");
    const rewardAddress = scriptHashToRewardAddress(policyId, this.networkId);
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };

    return { cbor, plutusScript, rewardAddress, policyId };
  }

  async protocol_param_mint(utxoReference: TxInput) {
    const validator = findValidator("protocol_params_mint", "mint");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(utxoReference.txHash),
          integer(utxoReference.outputIndex),
        ]),
      ],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");
    const address = serializePlutusScript(
      plutusScript,
      undefined,
      this.networkId,
      false
    ).address;
    return { cbor, plutusScript, policyId, address };
  }

  async registry_mint(
    params: ProtocolBootstrapParams | string,
    utxo?: TxInput
  ) {
    const validator = findValidator("registry_mint", "mint");

    let paramScriptHash: string;
    let parameter;
    if (typeof params === "string") {
      paramScriptHash = params;
      parameter = utxo;
    } else {
      paramScriptHash = params.directoryMintParams.issuanceScriptHash;
      parameter = params.directoryMintParams.txInput;
    }

    if (!parameter)
      throw new Error("register mint utxo parameter could not resolve");
    if (!paramScriptHash)
      throw new Error("registry mint param Script hash could not resolve");

    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(parameter.txHash),
          integer(parameter.outputIndex),
        ]),
        scriptHash(paramScriptHash),
      ],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");
    return { cbor, plutusScript, policyId };
  }

  async registry_spend(params: ProtocolBootstrapParams | string) {
    const validator = findValidator("registry_spend", "spend");
    let paramScriptHash: string;
    if (typeof params === "string") {
      paramScriptHash = params;
    } else {
      paramScriptHash = params.protocolParams.scriptHash;
    }
    if (!paramScriptHash)
      throw new Error("could not resolve params for registry spend");
    const cbor = applyParamsToScript(
      validator,
      [scriptHash(paramScriptHash)],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const address = serializePlutusScript(
      plutusScript,
      "",
      this.networkId,
      false
    ).address;
    const policyId = resolveScriptHash(cbor, "V3");
    return {
      cbor,
      plutusScript,
      address,
      policyId,
    };
  }

  async example_transfer_logic(permittedCredential: string) {
    const validator = findValidator("example_transfer_logic", "withdraw");
    const cbor = applyParamsToScript(
      validator,
      [scriptHash(permittedCredential)],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const address = serializePlutusScript(
      plutusScript,
      permittedCredential,
      this.networkId,
      true
    ).address;
    return { cbor, plutusScript, address };
  }

  async freeze_and_seize_transfer_logic(params: ProtocolBootstrapParams | string, blacklistNodeCs: string) {
    const validator = findValidator("example_transfer_logic", "withdraw");
    let paramScriptHash: string;
    if (typeof params === "string") {
      paramScriptHash = params;
    } else {
      paramScriptHash = params?.programmableLogicBaseParams.scriptHash!;
    }
    if (!paramScriptHash)
      throw new Error("could not resolve logic base parameter");
    const cbor = applyParamsToScript(
      validator,
      [scriptHash(paramScriptHash), scriptHash(blacklistNodeCs)],
      "JSON"
    );
    const plutusScript: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const address = serializePlutusScript(
      plutusScript,
      paramScriptHash,
      this.networkId,
      true
    ).address;
    return { cbor, plutusScript, address };
  }
}