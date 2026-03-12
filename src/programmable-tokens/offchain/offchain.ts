import {
  Asset,
  byteString,
  conStr0,
  conStr1,
  conStr2,
  none,
  stringToHex,
  UTxO,
} from "@meshsdk/common";

import { MeshTxInitiator, MeshTxInitiatorInput } from "../../common";
import { StandardScripts, SubStandardScripts } from "./common";
import { ProtocolBootstrapParams } from "./type";
import { splitWallet, waitForUtxosWithTimeout } from "./utils";

export class ProgrammableTokenContract extends MeshTxInitiator {
  params: ProtocolBootstrapParams | undefined;
  constructor(inputs: MeshTxInitiatorInput, params?: ProtocolBootstrapParams) {
    super(inputs);
    this.params = params;
  }

  protocolParamMint = async (): Promise<{
    params: ProtocolBootstrapParams;
    txHex: string;
  }> => {
    const wallet = this.wallet;
    const fetcher = this.fetcher;
    if (!wallet) throw new Error("Wallet is required");
    if (!fetcher) throw new Error("Fetcher is required");

    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();
    const refInputAddress =
      (await wallet.getUnusedAddresses())?.[0] ?? changeAddress;

    const standard = new StandardScripts(this.networkId);
    const subStandard = new SubStandardScripts(this.networkId);

    const txhash = await splitWallet(wallet, this.networkId as 0 | 1, fetcher);
    console.log(txhash);

    let utxo1: UTxO | undefined;
    let utxo2: UTxO | undefined;

    const splitUtxos = await waitForUtxosWithTimeout(txhash, fetcher);

    [utxo1, utxo2] = splitUtxos;

    if (utxo1 && utxo2) {
      const protocolParamMint = await standard.protocolParamMint(utxo1.input);
      const programmableLogicGlobal = await standard.programmableLogicGlobal(
        protocolParamMint.scriptHash,
      );
      const programmableLogicBase = await standard.programmableLogicBase(
        programmableLogicGlobal.scriptHash,
      );
      const issuanceCborHex = await standard.issuanceCborHexMint(utxo2.input);
      const registryMint = await standard.registryMint(
        issuanceCborHex.policyId,
        utxo1.input,
      );
      const registrySpend = await standard.registrySpend(
        protocolParamMint.scriptHash,
      );
      const transferSubstandard = await subStandard.transfer();
      const issuanceMint = await standard.issuanceMint(
        transferSubstandard.policyId,
        programmableLogicBase.policyId,
      );
      const protocolParamNftName = stringToHex("ProtocolParams");
      const issuanceNftName = stringToHex("IssuanceCborHex");

      const protocolParamsDatum = conStr0([
        byteString(registryMint.policyId),
        conStr1([byteString(programmableLogicBase.policyId)]),
      ]);

      const directoryDatum = conStr0([
        byteString(""), // Empty bytestring
        byteString(
          "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
        ), // Already hex
        conStr0([byteString("")]),
        conStr0([byteString("")]),
        byteString(""),
      ]);

      const protocolParamsAssets: Asset[] = [
        { unit: "lovelace", quantity: "1500000" },
        {
          unit: protocolParamMint.scriptHash + protocolParamNftName,
          quantity: "1",
        },
      ];
      const directoryAssets: Asset[] = [
        { unit: "lovelace", quantity: "1500000" },
        { unit: registryMint.policyId, quantity: "1" },
      ];
      const issuanceAssets: Asset[] = [
        { unit: "lovelace", quantity: "6500000" },
        { unit: issuanceCborHex.policyId + issuanceNftName, quantity: "1" },
      ];

      const contractParts = issuanceMint.cbor.split(
        transferSubstandard.policyId,
      );

      if (contractParts.length !== 2) {
        throw new Error("Failed to split issuance contract template");
      }

      const issuanceDatum = conStr0([
        byteString(contractParts[0]!),
        byteString(contractParts[1]!),
      ]);

      this.mesh
        .txIn(utxo1.input.txHash, utxo1.input.outputIndex)
        .txIn(utxo2.input.txHash, utxo2.input.outputIndex)

        .mintPlutusScriptV3()
        .mint("1", registryMint.policyId, stringToHex(""))
        .mintingScript(registryMint.cbor)
        .mintRedeemerValue(conStr0([]), "JSON")

        // Protocol Params mint (Constr 1)
        .mintPlutusScriptV3()
        .mint("1", protocolParamMint.scriptHash, protocolParamNftName)
        .mintingScript(protocolParamMint.cbor)
        .mintRedeemerValue(none(), "JSON")

        .mintPlutusScriptV3()
        .mint("1", issuanceCborHex.policyId, issuanceNftName)
        .mintingScript(issuanceCborHex.cbor)
        .mintRedeemerValue(conStr2([]), "JSON")

        .txOut(protocolParamMint.address, protocolParamsAssets)
        .txOutInlineDatumValue(protocolParamsDatum, "JSON")

        .txOut(registrySpend.address, directoryAssets)
        .txOutInlineDatumValue(directoryDatum, "JSON")

        .txOut(issuanceCborHex.address, issuanceAssets)
        .txOutInlineDatumValue(issuanceDatum, "JSON")

        .txOut(refInputAddress, [{ unit: "lovelace", quantity: "2500000" }])
        .txOutReferenceScript(programmableLogicBase.cbor, "V3")

        .txOut(refInputAddress, [{ unit: "lovelace", quantity: "15500000" }])
        .txOutReferenceScript(programmableLogicGlobal.cbor, "V3")

        .txOut(changeAddress, [{ unit: "lovelace", quantity: "50000000" }])
        .txOut(changeAddress, [{ unit: "lovelace", quantity: "50000000" }])

        .selectUtxosFrom(walletUtxos)
        .changeAddress(changeAddress)
        .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
        .setNetwork(this.networkId === 0 ? "preview" : "mainnet");

      const txHex = await this.mesh.complete();

      const placeholderTxHash = "insert txHash here after build";
      const params: ProtocolBootstrapParams = {
        txHash: placeholderTxHash,
        protocolParams: {
          txInput: {
            txHash: utxo1.input.txHash,
            outputIndex: utxo1.input.outputIndex,
          },
          scriptHash: protocolParamMint.scriptHash,
        },
        programmableLogicGlobalPrams: {
          protocolParamsScriptHash: protocolParamMint.scriptHash,
          scriptHash: programmableLogicGlobal.scriptHash,
        },
        programmableLogicBaseParams: {
          programmableLogicGlobalScriptHash: programmableLogicGlobal.scriptHash,
          scriptHash: programmableLogicBase.policyId,
        },
        issuanceParams: {
          txInput: {
            txHash: utxo2.input.txHash,
            outputIndex: utxo2.input.outputIndex,
          },
          scriptHash: issuanceCborHex.policyId,
        },
        directoryMintParams: {
          txInput: {
            txHash: utxo1.input.txHash,
            outputIndex: utxo1.input.outputIndex,
          },
          issuanceScriptHash: issuanceCborHex.policyId,
          scriptHash: registryMint.policyId,
        },
        directorySpendParams: {
          protocolParamsPolicyId: protocolParamMint.scriptHash,
          scriptHash: registrySpend.policyId,
        },
        programmableBaseRefInput: {
          txHash: placeholderTxHash,
          outputIndex: 3,
        },
        programmableGlobalRefInput: {
          txHash: placeholderTxHash,
          outputIndex: 4,
        },
      };

      return { params, txHex };
    }

    throw new Error("Could not resolve split wallet UTxOs");
  };

  registerToken = async (): Promise<string> => {
    throw new Error("registerToken is not yet implemented");
  };

  mintTokens = async (): Promise<string> => {
    throw new Error("mintTokens is not yet implemented");
  };

  transferToken = async (): Promise<string> => {
    throw new Error("transferToken is not yet implemented");
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
}
