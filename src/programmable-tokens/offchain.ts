import {
  Asset,
  byteString,
  conStr0,
  conStr1,
  integer,
  list,
  POLICY_ID_LENGTH,
  stringToHex,
  UTxO,
} from "@meshsdk/common";
import { deserializeDatum, resolveScriptHash } from "@meshsdk/core";
import {
  buildBaseAddress,
  CredentialType,
  deserializeAddress,
  Hash28ByteBase16,
  scriptHashToRewardAddress,
} from "@meshsdk/core-cst";

import { MeshTxInitiator, MeshTxInitiatorInput } from "../common";
import { Cip113_scripts_standard } from "./common";
import {
  ProtocolBootstrapParams,
  RegisterTokenParams,
  MintTokensParams,
  TransferTokenParams,
  RegistryDatum,
} from "./types";
import { parseRegistryDatum } from "./utils";

export class ProgrammableTokenContract extends MeshTxInitiator {
  params: ProtocolBootstrapParams | undefined;
  quantity: string;

  constructor(
    inputs: MeshTxInitiatorInput,
    params?: ProtocolBootstrapParams,
    quantity: string = "1"
  ) {
    super(inputs);
    this.params = params;
    this.quantity = quantity;
  }

  registerToken = async (params: RegisterTokenParams): Promise<string> => {
    const {
      assetName,
      scripts: {
        mintingLogic: mintingLogicPlutusScript,
        transferLogic: transferLogicPlutusScript,
        globalStateLogic: globalStateLogicPlutusScript,
        thirdPartyLogic: thirdPartyLogicPlutusScript,
      },
      transferRedeemerValue,
      recipientAddress,
    } = params;

    if (!this.params) {
      throw new Error(
        "Protocol bootstrap params are required.deploy protocolParambootstrap first if not done then pass as a param."
      );
    }

    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();
    const standardScript = new Cip113_scripts_standard(this.networkId);

    const registrySpend = await standardScript.registry_spend(this.params);
    const registryMint = await standardScript.registry_mint(this.params);
    const logicBase = await standardScript.programmable_logic_base(this.params);
    const mintingLogicScriptHash = resolveScriptHash(
      mintingLogicPlutusScript.code,
      mintingLogicPlutusScript.version
    );
    const issuanceMint = await standardScript.issuance_mint(
      mintingLogicScriptHash,
      this.params
    );

    const bootstrapTxHash = this.params.txHash;
    const protocolParamsUtxos = await this.fetcher?.fetchUTxOs(
      bootstrapTxHash,
      0
    );

    if (!protocolParamsUtxos) {
      throw new Error("Could not resolve protocol params");
    }

    const issuanceUtxos = await this.fetcher?.fetchUTxOs(bootstrapTxHash, 2);
    if (!issuanceUtxos) {
      throw new Error("Issuance UTXO not found");
    }

    const protocolParamsUtxo = protocolParamsUtxos[0];
    const issuanceUtxo = issuanceUtxos[0];
    let thirdPartyLogicScriptHash: string = "";
    let globalStateLogicScriptHash: string = "";

    const transferLogicScriptHash = resolveScriptHash(
      transferLogicPlutusScript.code,
      transferLogicPlutusScript.version
    );
    const transferAddress = scriptHashToRewardAddress(
      transferLogicScriptHash,
      this.networkId
    );
    if (thirdPartyLogicPlutusScript) {
      thirdPartyLogicScriptHash = resolveScriptHash(
        thirdPartyLogicPlutusScript.code,
        thirdPartyLogicPlutusScript.version
      );
    }
    if (globalStateLogicPlutusScript) {
      globalStateLogicScriptHash = resolveScriptHash(
        globalStateLogicPlutusScript.code,
        globalStateLogicPlutusScript.version
      );
    }
    const tokenPolicyId = issuanceMint.policyId;
    const registryEntries = await this.fetcher?.fetchAddressUTxOs(
      registrySpend.address
    );
    const registryEntriesDatums = registryEntries?.flatMap((utxo: UTxO) =>
      deserializeDatum(utxo.output.plutusData!)
    );

    const existingEntry = registryEntriesDatums
      ?.map(parseRegistryDatum)
      .filter((d): d is RegistryDatum => d !== null)
      .find((d) => d.key === tokenPolicyId);

    if (existingEntry) {
      throw new Error(`Token policy ${tokenPolicyId} already registered`);
    }

    const nodeToReplaceUtxo = registryEntries?.find((utxo) => {
      const datum = deserializeDatum(utxo.output.plutusData!);
      const parsedDatum = parseRegistryDatum(datum);

      if (!parsedDatum) {
        console.log("Could not parse registry datum");
        return false;
      }

      const after = parsedDatum.key.localeCompare(tokenPolicyId) < 0;
      const before = tokenPolicyId.localeCompare(parsedDatum.next) < 0;

      return after && before;
    });

    if (!nodeToReplaceUtxo) {
      throw new Error("Could not find node to replace");
    }

    const existingRegistryNodeDatum = parseRegistryDatum(
      deserializeDatum(nodeToReplaceUtxo.output.plutusData!)
    );

    if (!existingRegistryNodeDatum) {
      throw new Error("Could not parse current registry node");
    }

    const stakeCredential = deserializeAddress(
      recipientAddress ? recipientAddress : walletAddress
    )
      .asBase()
      ?.getStakeCredential().hash!;
    const targetAddress = buildBaseAddress(
      0,
      logicBase.policyId as Hash28ByteBase16,
      stakeCredential,
      CredentialType.ScriptHash,
      CredentialType.KeyHash
    );

    const registryMintRedeemer = conStr1([
      byteString(tokenPolicyId),
      byteString(mintingLogicScriptHash),
    ]);

    const issuanceRedeemer = conStr0([
      conStr1([byteString(mintingLogicScriptHash)]),
    ]);

    const previousNodeDatum = conStr0([
      byteString(existingRegistryNodeDatum.key),
      byteString(tokenPolicyId),
      byteString(existingRegistryNodeDatum.transferScriptHash),
      byteString(existingRegistryNodeDatum.thirdPartyScriptHash),
      byteString(existingRegistryNodeDatum.metadata),
    ]);

    const newNodeDatum = conStr0([
      byteString(tokenPolicyId),
      byteString(existingRegistryNodeDatum.next),
      byteString(transferLogicScriptHash),
      byteString(thirdPartyLogicScriptHash),
      byteString(globalStateLogicScriptHash),
    ]);

    const directorySpendAssets: Asset[] = [
      { unit: "lovelace", quantity: "1500000" },
      { unit: registryMint.policyId, quantity: "1" },
    ];

    const directoryMintAssets: Asset[] = [
      { unit: "lovelace", quantity: "1500000" },
      { unit: registryMint.policyId + tokenPolicyId, quantity: "1" },
    ];

    const programmableTokenAssets: Asset[] = [
      { unit: "lovelace", quantity: "1500000" },
      {
        unit: tokenPolicyId + stringToHex(assetName),
        quantity: this.quantity,
      },
    ];

    const txHex = await this.mesh
      .spendingPlutusScriptV3()
      .txIn(nodeToReplaceUtxo.input.txHash, nodeToReplaceUtxo.input.outputIndex)
      .txInScript(registrySpend.cbor)
      .txInRedeemerValue(conStr0([]), "JSON")
      .txInInlineDatumPresent()
      .withdrawalPlutusScriptV3()
      .withdrawal(transferAddress, "0")
      .withdrawalScript(transferLogicPlutusScript.code)
      .withdrawalRedeemerValue(transferRedeemerValue, "JSON")
      .mintPlutusScriptV3()
      .mint(this.quantity, tokenPolicyId, stringToHex(assetName))
      .mintingScript(issuanceMint.cbor)
      .mintRedeemerValue(issuanceRedeemer, "JSON")
      .mintPlutusScriptV3()
      .mint("1", registryMint.policyId, tokenPolicyId)
      .mintingScript(registryMint.cbor)
      .mintRedeemerValue(registryMintRedeemer, "JSON")

      .txOut(targetAddress.toAddress().toBech32(), programmableTokenAssets)
      .txOutInlineDatumValue(conStr0([]), "JSON")
      .txOut(registrySpend.address, directorySpendAssets)
      .txOutInlineDatumValue(previousNodeDatum, "JSON")
      .txOut(registrySpend.address, directoryMintAssets)
      .txOutInlineDatumValue(newNodeDatum, "JSON")

      .readOnlyTxInReference(
        protocolParamsUtxo!.input.txHash,
        protocolParamsUtxo!.input.outputIndex
      )
      .readOnlyTxInReference(
        issuanceUtxo!.input.txHash,
        issuanceUtxo!.input.outputIndex
      )
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .complete();

    return txHex;
  };

  mintTokens = async (params: MintTokensParams): Promise<string> => {
    const {
      assetName,
      scripts: {
        mintingLogic: mintingLogicPlutusScript,
        transferLogic: transferLogicPlutusScript,
      },
      transferRedeemerValue,
      recipientAddress,
    } = params;

    if (!this.params) {
      throw new Error(
        "Protocol bootstrap params are required. Call protocolParambootstrap first."
      );
    }

    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();
    const standardScript = new Cip113_scripts_standard(this.networkId);

    const mintingLogicScriptHash = resolveScriptHash(
      mintingLogicPlutusScript.code,
      mintingLogicPlutusScript.version
    );
    const transferLogicScriptHash = resolveScriptHash(
      transferLogicPlutusScript.code,
      transferLogicPlutusScript.version
    );
    const transferAddress = scriptHashToRewardAddress(
      transferLogicScriptHash,
      this.networkId
    );
    const issuanceMint = await standardScript.issuance_mint(
      mintingLogicScriptHash,
      this.params
    );
    const senderCredential = deserializeAddress(
      recipientAddress ? recipientAddress : walletAddress
    ).asBase();
    if (!senderCredential) {
      throw new Error("Sender credential not found");
    }
    const logicBase = await standardScript.programmable_logic_base(this.params);
    const logicAddress = buildBaseAddress(
      0,
      logicBase.policyId as Hash28ByteBase16,
      senderCredential.getPaymentCredential().hash,
      CredentialType.ScriptHash,
      CredentialType.KeyHash
    );
    const targetAddress = logicAddress.toAddress().toBech32();
    console.log("target address", targetAddress);

    const issuanceRedeemer = conStr0([
      conStr1([byteString(mintingLogicScriptHash)]),
    ]);

    const programmableTokenAssets: Asset[] = [
      { unit: "lovelace", quantity: "1500000" },
      {
        unit: issuanceMint.policyId + stringToHex(assetName),
        quantity: this.quantity,
      },
    ];

    const programmableTokenDatum = conStr0([]);

    const txHex = await this.mesh
      .withdrawalPlutusScriptV3()
      .withdrawal(transferAddress, "0")
      .withdrawalScript(transferLogicPlutusScript.code)
      .withdrawalRedeemerValue(transferRedeemerValue, "JSON")

      .mintPlutusScriptV3()
      .mint(this.quantity, issuanceMint.policyId, stringToHex(assetName))
      .mintingScript(issuanceMint.cbor)
      .mintRedeemerValue(issuanceRedeemer, "JSON")

      .txOut(targetAddress, programmableTokenAssets)
      .txOutInlineDatumValue(programmableTokenDatum, "JSON")

      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress)
      .complete();
    return txHex;
  };

  transferToken = async (params: TransferTokenParams): Promise<string> => {
    const {
      unit,
      quantity,
      recipientAddress,
      transferLogic: transferLogicPlutusScript,
      transferRedeemerValue,
    } = params;

    if (!this.params) {
      throw new Error(
        "Protocol bootstrap params are required. Call protocolParambootstrap first."
      );
    }

    const { utxos, walletAddress, collateral } =
      await this.getWalletInfoForTx();
    const policyId = unit.substring(0, POLICY_ID_LENGTH);
    const standardScript = new Cip113_scripts_standard(this.networkId);
    const logicBase = await standardScript.programmable_logic_base(this.params);
    const logicGlobal = await standardScript.programmable_logic_global(
      this.params
    );
    const registrySpend = await standardScript.registry_spend(this.params);
    const transferLogicScriptHash = resolveScriptHash(
      transferLogicPlutusScript.code,
      transferLogicPlutusScript.version
    );
    const transferAddress = scriptHashToRewardAddress(
      transferLogicScriptHash,
      this.networkId
    );
    const senderCredential = deserializeAddress(walletAddress)
      .asBase()
      ?.getStakeCredential().hash;

    const recipientCredential = deserializeAddress(recipientAddress)
      .asBase()
      ?.getStakeCredential().hash;

    const senderBaseAddress = buildBaseAddress(
      0,
      logicBase.policyId as Hash28ByteBase16,
      senderCredential!,
      CredentialType.ScriptHash,
      CredentialType.KeyHash
    );
    const recipientBaseAddress = buildBaseAddress(
      0,
      logicBase.policyId as Hash28ByteBase16,
      recipientCredential!,
      CredentialType.ScriptHash,
      CredentialType.KeyHash
    );
    const senderAddress = senderBaseAddress.toAddress().toBech32();
    const targetAddress = recipientBaseAddress.toAddress().toBech32();

    const registryUtxos = await this.fetcher?.fetchAddressUTxOs(
      registrySpend.address
    );
    if (!registryUtxos) {
      throw new Error("Could not find registry entry for utxos");
    }

    const tokenRegistry = registryUtxos?.find((utxo) => {
      const datum = deserializeDatum(utxo.output.plutusData!);
      const parsedDatum = parseRegistryDatum(datum);
      return parsedDatum?.key === policyId;
    });

    if (!tokenRegistry) {
      throw new Error("Could not find registry entry for token");
    }

    const protocolParamsUtxos = await this.fetcher?.fetchUTxOs(
      this.params.txHash,
      0
    );
    if (!protocolParamsUtxos) {
      throw new Error("Could not resolve protocol params");
    }
    const protocolParamsUtxo = protocolParamsUtxos[0];

    const senderTokenUtxos = await this.fetcher?.fetchAddressUTxOs(
      senderAddress
    );
    if (!senderTokenUtxos) {
      throw new Error("No programmable tokens found at sender address");
    }

    let totalTokenBalance = 0;
    senderTokenUtxos.forEach((utxo) => {
      const tokenAsset = utxo.output.amount.find((a) => a.unit === unit);
      if (tokenAsset) totalTokenBalance += Number(tokenAsset.quantity);
    });

    const transferAmount = Number(quantity);
    if (totalTokenBalance < transferAmount) throw new Error("Not enough funds");

    let selectedUtxos: UTxO[] = [];
    let selectedAmount = 0;
    for (const utxo of senderTokenUtxos) {
      if (selectedAmount >= transferAmount) break;
      const tokenAsset = utxo.output.amount.find((a) => a.unit === unit);
      if (tokenAsset) {
        selectedUtxos.push(utxo);
        selectedAmount += Number(tokenAsset.quantity);
      }
    }

    const returningAmount = selectedAmount - transferAmount;

    const registryProof = conStr0([integer(1)]);
    const programmableLogicGlobalRedeemer = conStr0([list([registryProof])]);
    const spendingRedeemer = conStr0([]);
    const tokenDatum = conStr0([]);

    const recipientAssets: Asset[] = [
      { unit: "lovelace", quantity: "1300000" },
      { unit: unit, quantity: transferAmount.toString() },
    ];

    const returningAssets: Asset[] = [
      { unit: "lovelace", quantity: "1300000" },
    ];
    if (returningAmount > 0) {
      returningAssets.push({
        unit: unit,
        quantity: returningAmount.toString(),
      });
    }
    const txHex = await this.mesh;

    for (const utxo of selectedUtxos) {
      txHex
        .spendingPlutusScriptV3()
        .txIn(utxo.input.txHash, utxo.input.outputIndex)
        .txInScript(logicBase.cbor)
        .txInRedeemerValue(spendingRedeemer, "JSON")
        .txInInlineDatumPresent();
    }

    txHex
      .withdrawalPlutusScriptV3()
      .withdrawal(transferAddress, "0")
      .withdrawalScript(transferLogicPlutusScript.code)
      .withdrawalRedeemerValue(transferRedeemerValue, "JSON")

      .withdrawalPlutusScriptV3()
      .withdrawal(logicGlobal.rewardAddress, "0")
      .withdrawalScript(logicGlobal.cbor)
      .withdrawalRedeemerValue(programmableLogicGlobalRedeemer, "JSON")
      .requiredSignerHash(senderCredential!.toString())
      .txOut(walletAddress, [
        {
          unit: "lovelace",
          quantity: "1000000",
        },
      ]);

    if (returningAmount > 0) {
      txHex
        .txOut(senderAddress, returningAssets)
        .txOutInlineDatumValue(tokenDatum, "JSON");
    }

    txHex
      .txOut(targetAddress, recipientAssets)
      .txOutInlineDatumValue(tokenDatum, "JSON")

      .readOnlyTxInReference(
        protocolParamsUtxo!.input.txHash,
        protocolParamsUtxo!.input.outputIndex
      )
      .readOnlyTxInReference(
        tokenRegistry!.input.txHash,
        tokenRegistry.input.outputIndex
      )

      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(utxos)
      .changeAddress(walletAddress);

    const unsignedTx = await txHex.complete();
    return unsignedTx;
  };

  blacklistToken = async (): Promise<void> => {
    throw new Error("blacklistToken is not yet implemented");
  };
  whitelistToken = async (): Promise<void> => {
    throw new Error("whitelistToken is not yet implemented");
  };

  freezeToken = async (): Promise<void> => {
    throw new Error("freezeToken is not yet implemented");
  };

  seizeToken = async (): Promise<void> => {
    throw new Error("seizeToken is not yet implemented");
  };

  unfreezeToken = async (): Promise<void> => {
    throw new Error("unfreezeToken is not yet implemented");
  };
  unseizeToken = async (): Promise<void> => {
    throw new Error("unseizeToken is not yet implemented");
  };

  burnToken = async (): Promise<void> => {
    throw new Error("burnToken is not yet implemented");
  };

  protocolParambootstrap = async (): Promise<void> => {
    throw new Error("protocolParambootstrap is not yet implemented");
  };
}
