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

import { ProtocolBootstrapParams } from "../types";
import { findValidator } from "../utils";

export class Cip113_scripts_standard {
  private networkID: number;
  constructor(networkID: number) {
    this.networkID = networkID;
  }
  async blacklist_mint(utxo_reference: TxInput, manager_pubkey_hash: string) {
    const validator = findValidator("blacklist_mint", "mint");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(utxo_reference.txHash),
          integer(utxo_reference.outputIndex),
        ]),
        byteString(manager_pubkey_hash),
      ],
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policy_id = resolveScriptHash(cbor, "V3");

    return { cbor, plutus_script, policy_id };
  }

  async issuance_mint(
    mintingLogicCredential: string,
    params: ProtocolBootstrapParams | string,
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
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policy_id = resolveScriptHash(cbor, "V3");
    const address = serializePlutusScript(
      plutus_script,
      undefined,
      this.networkID,
      false,
    ).address;
    return { cbor, plutus_script, policy_id, address };
  }

  async issuance_cbor_hex_mint(utxo_reference: TxInput) {
    const validator = findValidator("issuance_cbor_hex_mint", "mint");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(utxo_reference.txHash),
          integer(utxo_reference.outputIndex),
        ]),
      ],
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policy_id = resolveScriptHash(cbor, "V3");
    const address = serializePlutusScript(
      plutus_script,
      undefined,
      this.networkID,
      false,
    ).address;
    return { cbor, plutus_script, policy_id, address };
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
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policyId = resolveScriptHash(cbor, "V3");
    return {
      cbor,
      plutus_script,
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
      "JSON",
    );
    const script_hash = resolveScriptHash(cbor, "V3");
    const reward_address = scriptHashToRewardAddress(
      script_hash,
      this.networkID,
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };

    return { cbor, plutus_script, reward_address, script_hash };
  }

  async protocol_param_mint(utxo_reference: TxInput) {
    const validator = findValidator("protocol_params_mint", "mint");
    const cbor = applyParamsToScript(
      validator,
      [
        conStr(0, [
          byteString(utxo_reference.txHash),
          integer(utxo_reference.outputIndex),
        ]),
      ],
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const script_hash = resolveScriptHash(cbor, "V3");
    const address = serializePlutusScript(
      plutus_script,
      undefined,
      this.networkID,
      false,
    ).address;
    return { cbor, plutus_script, script_hash, address };
  }

  async registry_mint(
    params: ProtocolBootstrapParams | string,
    utxo?: TxInput,
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
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const policy_id = resolveScriptHash(cbor, "V3");
    return { cbor, plutus_script, policy_id };
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
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const address = serializePlutusScript(
      plutus_script,
      "",
      this.networkID,
      false,
    ).address;
    const policy_id = resolveScriptHash(cbor, "V3");
    return {
      cbor,
      plutus_script,
      address,
      policy_id,
    };
  }

  async example_transfer_logic(permitted_credential: string) {
    const validator = findValidator("example_transfer_logic", "withdraw");
    const cbor = applyParamsToScript(
      validator,
      [scriptHash(permitted_credential)],
      "JSON",
    );
    const plutus_script: PlutusScript = {
      code: cbor,
      version: "V3",
    };
    const address = serializePlutusScript(
      plutus_script,
      permitted_credential,
      this.networkID,
      true,
    ).address;
    return { cbor, plutus_script, address };
  }
}
