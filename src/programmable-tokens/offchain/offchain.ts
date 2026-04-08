import {
  Asset,
  byteString,
  conStr0,
  conStr1,
  conStr2,
  integer,
  list,
  none,
  POLICY_ID_LENGTH,
  stringToHex,
  UTxO,
} from "@meshsdk/common";
import { deserializeDatum } from "@meshsdk/core";
import { deserializeAddress } from "@meshsdk/core-cst";

import { MeshTxInitiator, MeshTxInitiatorInput } from "../../common";
import { StandardScripts, SubStandardScripts } from "./common";
import { BlacklistBootstrap, ProtocolBootstrapParams } from "./type";
import {
  buildBlacklistScripts,
  getSmartWalletAddress,
  parseBlacklistDatum,
  parseRegistryDatum,
  selectProgrammableTokenUtxos,
} from "./utils";

export class ProgrammableTokenContract extends MeshTxInitiator {
  private params: ProtocolBootstrapParams | undefined;
  private blacklistBootstrap: BlacklistBootstrap | undefined;
  constructor(
    private inputs: MeshTxInitiatorInput,
    params?: ProtocolBootstrapParams,
    blacklistBootstrap?: BlacklistBootstrap,
  ) {
    super(inputs);
    this.params = params;
    this.blacklistBootstrap = blacklistBootstrap;
  }

  mintTokens = async (
    assetName: string,
    quantity: string,
    issuerAdminPkh: string,
    recipientAddress?: string | null,
  ): Promise<string> => {
    const params = this.params;
    const fetcher = this.fetcher;
    const wallet = this.wallet;
    if (!params || !fetcher || !wallet)
      throw new Error(
        "Contract parameters, fetcher, or wallet not initialized",
      );

    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();

    const standardScript = new StandardScripts(this.networkId);
    const substandardScript = new SubStandardScripts(this.networkId);

    const substandardIssue =
      await substandardScript.issuerAdmin(issuerAdminPkh);
    const substandardIssueCbor = substandardIssue.cbor;
    const substandardPolicyId = substandardIssue.policyId;

    const issuanceMint = await standardScript.issuanceMint(
      substandardPolicyId,
      params,
    );
    const smartWalletAddress = await getSmartWalletAddress(
      recipientAddress ? recipientAddress : changeAddress,
      params,
      this.networkId as 0 | 1,
    );

    const issuanceRedeemer = conStr0([
      conStr1([byteString(substandardPolicyId)]),
    ]);

    const programmableTokenAssets: Asset[] = [
      { unit: "lovelace", quantity: "1300000" },
      {
        unit: issuanceMint.policyId + stringToHex(assetName),
        quantity: quantity,
      },
    ];

    const programmableTokenDatum = conStr0([]);

    this.mesh.txEvaluationMultiplier = 1.3;
    this.mesh
      .withdrawalPlutusScriptV3()
      .withdrawal(substandardIssue.rewardAddress, "0")
      .withdrawalScript(substandardIssueCbor)
      .withdrawalRedeemerValue(conStr0([]), "JSON")

      .mintPlutusScriptV3()
      .mint(quantity, issuanceMint.policyId, stringToHex(assetName))
      .mintingScript(issuanceMint.cbor)
      .mintRedeemerValue(issuanceRedeemer, "JSON")

      .txOut(smartWalletAddress, programmableTokenAssets)
      .txOutInlineDatumValue(programmableTokenDatum, "JSON")

      .requiredSignerHash(issuerAdminPkh)
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(walletUtxos)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .changeAddress(changeAddress);

    return await this.mesh.complete();
  };

  burnToken = async (request: {
    tokenPolicyId: string;
    assetName: string;
    quantity: string;
    txhash: string;
    outputIndex: number;
    issuerAdminPkh: string;
  }): Promise<string> => {
    const params = this.params;
    const fetcher = this.fetcher;
    const wallet = this.wallet;
    if (!params || !fetcher || !wallet)
      throw new Error(
        "Contract parameters, fetcher, or wallet not initialized",
      );

    const {
      tokenPolicyId,
      assetName,
      quantity,
      txhash,
      outputIndex,
      issuerAdminPkh,
    } = request;
    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();

    const standard = new StandardScripts(this.networkId);
    const substandard = new SubStandardScripts(this.networkId);

    const programmableLogicBase = await standard.programmableLogicBase(params);
    const programmableLogicGlobal =
      await standard.programmableLogicGlobal(params);
    const registrySpend = await standard.registrySpend(params);
    const substandardIssue = await substandard.issuerAdmin(issuerAdminPkh);
    const issuanceMint = await standard.issuanceMint(
      substandardIssue.policyId,
      params,
    );

    const utxoToBurn = (await fetcher.fetchUTxOs(txhash, outputIndex))?.[0];
    if (!utxoToBurn) throw new Error("Token UTxO not found");

    const tokenUnit = issuanceMint.policyId + stringToHex(assetName);
    const utxoTokenAmount =
      utxoToBurn.output.amount.find((a) => a.unit === tokenUnit)?.quantity ??
      "0";
    if (Number(quantity) > Number(utxoTokenAmount))
      throw new Error("Not enough tokens to burn");

    const registryUtxos = await fetcher.fetchAddressUTxOs(
      registrySpend.address,
    );
    const progTokenRegistry = registryUtxos.find((utxo) => {
      if (!utxo.output.plutusData) return false;
      const parsed = parseRegistryDatum(
        deserializeDatum(utxo.output.plutusData),
      );
      return parsed?.key === tokenPolicyId;
    });
    if (!progTokenRegistry)
      throw new Error("Registry entry not found, token not registered");

    const feePayerUtxo = walletUtxos.find(
      (u) =>
        BigInt(
          u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0",
        ) > 5_000_000n,
    );
    if (!feePayerUtxo)
      throw new Error("No UTXO with enough ADA for fees found");

    const protocolParamsUtxo = (
      await fetcher.fetchUTxOs(params.txHash, 0)
    )?.[0];
    if (!protocolParamsUtxo) throw new Error("Protocol params missing");

    const totalInputs = 2; // feePayerUtxo + utxoToBurn

    const compareUtxos = (a: UTxO, b: UTxO): number =>
      a.input.txHash !== b.input.txHash
        ? a.input.txHash.localeCompare(b.input.txHash)
        : a.input.outputIndex - b.input.outputIndex;

    const sortedRefInputs = [protocolParamsUtxo, progTokenRegistry].sort(
      compareUtxos,
    );

    const registryRefInputIndex = sortedRefInputs.findIndex(
      (r) =>
        r.input.txHash === progTokenRegistry.input.txHash &&
        r.input.outputIndex === progTokenRegistry.input.outputIndex,
    );
    if (registryRefInputIndex === -1)
      throw new Error("Could not find registry in sorted reference inputs");

    const issuanceRedeemer = conStr0([
      conStr1([byteString(substandardIssue.policyId)]),
    ]);

    const programmableGlobalRedeemer = conStr1([
      integer(registryRefInputIndex),
      integer(0), // outputs_start_idx
      integer(totalInputs), // length_inputs
    ]);

    const returningAmount = utxoToBurn.output.amount
      .map((a) =>
        a.unit === tokenUnit
          ? {
              unit: a.unit,
              quantity: String(BigInt(a.quantity) - BigInt(quantity)),
            }
          : a,
      )
      .filter((a) => BigInt(a.quantity) > 0n);

    this.mesh.txEvaluationMultiplier = 1.3;
    this.mesh
      .txIn(feePayerUtxo.input.txHash, feePayerUtxo.input.outputIndex)
      .spendingPlutusScriptV3()
      .txIn(utxoToBurn.input.txHash, utxoToBurn.input.outputIndex)
      .txInScript(programmableLogicBase.cbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(conStr0([]), "JSON")

      .withdrawalPlutusScriptV3()
      .withdrawal(substandardIssue.rewardAddress, "0")
      .withdrawalScript(substandardIssue.cbor)
      .withdrawalRedeemerValue(conStr0([]), "JSON")

      .withdrawalPlutusScriptV3()
      .withdrawal(programmableLogicGlobal.rewardAddress, "0")
      .withdrawalScript(programmableLogicGlobal.cbor)
      .withdrawalRedeemerValue(programmableGlobalRedeemer, "JSON")

      .mintPlutusScriptV3()
      .mint(`-${quantity}`, issuanceMint.policyId, stringToHex(assetName))
      .mintingScript(issuanceMint.cbor)
      .mintRedeemerValue(issuanceRedeemer, "JSON");

    if (returningAmount.length > 0) {
      this.mesh
        .txOut(utxoToBurn.output.address, returningAmount)
        .txOutInlineDatumValue(conStr0([]), "JSON");
    }

    for (const refInput of sortedRefInputs) {
      this.mesh.readOnlyTxInReference(
        refInput.input.txHash,
        refInput.input.outputIndex,
      );
    }

    this.mesh
      .requiredSignerHash(issuerAdminPkh)
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(walletUtxos)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .changeAddress(changeAddress);

    return await this.mesh.complete();
  };

  transferToken = async (
    unit: string,
    quantity: string,
    recipientAddress: string,
  ): Promise<string> => {
    const params = this.params;
    const fetcher = this.fetcher;
    const wallet = this.wallet;
    if (!params || !fetcher || !wallet)
      throw new Error(
        "Contract parameters, fetcher, or wallet not initialized",
      );

    const policyId = unit.substring(0, POLICY_ID_LENGTH);
    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();

    const standard = new StandardScripts(this.networkId);
    const substandard = new SubStandardScripts(this.networkId);

    const programmableLogicBase = await standard.programmableLogicBase(params);
    const programmableLogicGlobal =
      await standard.programmableLogicGlobal(params);
    const registrySpend = await standard.registrySpend(params);

    if (!this.blacklistBootstrap)
      throw new Error("Blacklist bootstrap not initialized");
    const blacklistNodePolicyId =
      this.blacklistBootstrap.blacklistMintBootstrap.scriptHash;
    const substandardTransfer = await substandard.customTransfer(
      params.programmableLogicBaseParams.scriptHash,
      blacklistNodePolicyId,
    );
    const substandardTransferCbor = substandardTransfer.cbor;

    const senderCredential = deserializeAddress(changeAddress).asBase()
      ?.getStakeCredential().hash;
    if (!senderCredential)
      throw new Error("Sender address must include a stake credential");

    const senderSmartWallet = await getSmartWalletAddress(
      changeAddress,
      params,
      this.networkId as 0 | 1,
    );
    const recipientSmartWallet = await getSmartWalletAddress(
      recipientAddress,
      params,
      this.networkId as 0 | 1,
    );

    const progTokenRegistry = (
      await fetcher.fetchAddressUTxOs(registrySpend.address)
    ).find((utxo: UTxO) => {
      if (!utxo.output.plutusData) return false;
      return (
        parseRegistryDatum(deserializeDatum(utxo.output.plutusData))?.key ===
        policyId
      );
    });
    if (!progTokenRegistry)
      throw new Error("Could not find registry entry for token");

    const protocolParamsUtxo = (
      await fetcher.fetchUTxOs(params.txHash, 0)
    )?.[0];
    if (!protocolParamsUtxo)
      throw new Error("Could not resolve protocol params");

    const senderProgTokenUtxos =
      await fetcher.fetchAddressUTxOs(senderSmartWallet);
    if (!senderProgTokenUtxos?.length)
      throw new Error("No programmable tokens found at sender address");

    const { selectedUtxos } = await selectProgrammableTokenUtxos(
      senderProgTokenUtxos,
      unit,
      Number(quantity),
    );
    if (!selectedUtxos.length) throw new Error("Not enough funds");

    const compareUtxos = (a: UTxO, b: UTxO): number =>
      a.input.txHash !== b.input.txHash
        ? a.input.txHash.localeCompare(b.input.txHash)
        : a.input.outputIndex - b.input.outputIndex;

    const sortedInputs = [...selectedUtxos].sort(compareUtxos);
    const programmableInputs: UTxO[] = [];
    const uniquePolicies: string[] = [];

    for (const utxo of sortedInputs) {
      programmableInputs.push(utxo);
      for (const asset of utxo.output.amount) {
        if (asset.unit === "lovelace") continue;
        const p = asset.unit.substring(0, 56);
        if (!uniquePolicies.includes(p)) uniquePolicies.push(p);
      }
    }
    uniquePolicies.sort();

    const blacklistProofs: UTxO[] = [];
    if (blacklistNodePolicyId) {
      const blacklistSpend = await substandard.blacklistSpend(
        blacklistNodePolicyId,
      );
      const blacklistUtxos = await fetcher.fetchAddressUTxOs(
        blacklistSpend.address,
      );

      for (const utxo of programmableInputs) {
        const stakingPkh = deserializeAddress(utxo.output.address).asBase()
          ?.getStakeCredential().hash;
        if (!stakingPkh) throw new Error("UTXO missing stake credential");

        const proofUtxo = blacklistUtxos.find((bl: UTxO) => {
          if (!bl.output.plutusData) return false;
          const datum = parseBlacklistDatum(
            deserializeDatum(bl.output.plutusData),
          );
          if (!datum) return false;
          const isGreater = datum.key === "" || stakingPkh > datum.key;
          const isLess = datum.next === "" || stakingPkh < datum.next;
          return isGreater && isLess;
        });

        if (!proofUtxo)
          throw new Error(`Blacklist proof not found for wallet ${stakingPkh}`);
        blacklistProofs.push(proofUtxo);
      }
    }

    const registryProofs: UTxO[] = [];
    const registryUtxos = await fetcher.fetchAddressUTxOs(
      registrySpend.address,
    );
    for (const p of uniquePolicies) {
      const registryNft = params.directoryMintParams.scriptHash + p;
      const proofUtxo = registryUtxos.find((u) =>
        u.output.amount.find((a) => a.unit === registryNft),
      );
      if (!proofUtxo)
        throw new Error(`Registry node not found for policy ${p}`);
      registryProofs.push(proofUtxo);
    }

    const uniqueBlacklistProofs = [
      ...new Map(
        blacklistProofs.map((p) => [
          `${p.input.txHash}#${p.input.outputIndex}`,
          p,
        ]),
      ).values(),
    ];

    const sortedRefInputs = [
      ...uniqueBlacklistProofs,
      ...registryProofs,
      protocolParamsUtxo,
    ].sort(compareUtxos);

    const substandardTransferRedeemer = list(
      blacklistProofs.map((p) => {
        const idx = sortedRefInputs.findIndex(
          (r) =>
            r.input.txHash === p.input.txHash &&
            r.input.outputIndex === p.input.outputIndex,
        );
        return conStr0([integer(idx)]);
      }),
    );

    const programmableGlobalRedeemer = conStr0([
      list(
        registryProofs.map((p) => {
          const idx = sortedRefInputs.findIndex(
            (r) =>
              r.input.txHash === p.input.txHash &&
              r.input.outputIndex === p.input.outputIndex,
          );
          return conStr0([integer(idx)]);
        }),
      ),
    ]);

    const totalTokens = selectedUtxos.reduce(
      (sum, utxo) =>
        sum +
        BigInt(
          utxo.output.amount.find((a) => a.unit === unit)?.quantity ?? "0",
        ),
      0n,
    );
    const totalLovelace = selectedUtxos.reduce(
      (sum, utxo) =>
        sum +
        BigInt(
          utxo.output.amount.find((a) => a.unit === "lovelace")?.quantity ??
            "0",
        ),
      0n,
    );

    if (totalTokens < BigInt(quantity)) throw new Error("Not enough funds");

    const recipientLovelace = 1500000n;
    const remainingTokens = totalTokens - BigInt(quantity);
    const recipientAssets = [
      { unit: "lovelace", quantity: recipientLovelace.toString() },
      { unit: unit, quantity: quantity },
    ];
    const remainingLovelace = totalLovelace - recipientLovelace;
    const returningAssets = [
      {
        unit: "lovelace",
        quantity: (remainingLovelace > 1_000_000n
          ? remainingLovelace
          : 1_500_000n
        ).toString(),
      },
      ...(remainingTokens > 0n
        ? [{ unit: unit, quantity: remainingTokens.toString() }]
        : []),
    ];

    this.mesh.verbose = true;
    this.mesh.evaluator = this.inputs.mesh.evaluator;
    for (const utxo of sortedInputs) {
      this.mesh
        .spendingPlutusScriptV3()
        .txIn(utxo.input.txHash, utxo.input.outputIndex)
        .txInScript(programmableLogicBase.cbor)
        .txInRedeemerValue(conStr0([]), "JSON")
        .txInInlineDatumPresent();
    }

    this.mesh
      .withdrawalPlutusScriptV3()
      .withdrawal(substandardTransfer.rewardAddress, "0")
      .withdrawalScript(substandardTransferCbor)
      .withdrawalRedeemerValue(substandardTransferRedeemer, "JSON")

      .withdrawalPlutusScriptV3()
      .withdrawal(programmableLogicGlobal.rewardAddress, "0")
      .withdrawalScript(programmableLogicGlobal.cbor)
      .withdrawalRedeemerValue(programmableGlobalRedeemer, "JSON");

    if (remainingTokens > 0n || remainingLovelace > 1_000_000n) {
      this.mesh
        .txOut(senderSmartWallet, returningAssets)
        .txOutInlineDatumValue(conStr0([]), "JSON");
    }

    this.mesh
      .txOut(recipientSmartWallet, recipientAssets)
      .txOutInlineDatumValue(conStr0([]), "JSON");

    for (const refInput of sortedRefInputs) {
      this.mesh.readOnlyTxInReference(
        refInput.input.txHash,
        refInput.input.outputIndex,
      );
    }

    this.mesh
      .requiredSignerHash(senderCredential)
      .setFee("600000")
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(walletUtxos)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .changeAddress(changeAddress);

    return await this.mesh.complete();
  };

  blacklistAddress = async (targetAddress: string): Promise<string> => {
    const fetcher = this.fetcher;
    const wallet = this.wallet;
    if (!fetcher || !wallet)
      throw new Error("Fetcher or wallet not initialized");

    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();

    const addressToBlacklist = deserializeAddress(targetAddress);
    const targetStakingPkh = addressToBlacklist
      .asBase()
      ?.getStakeCredential().hash;
    if (!targetStakingPkh)
      throw new Error("Target address must include a stake credential");

    if (!this.blacklistBootstrap)
      throw new Error("Blacklist bootstrap not initialized");
    const blacklistMintBootstrap =
      this.blacklistBootstrap.blacklistMintBootstrap;
    const { blacklistMint, blacklistSpend } = await buildBlacklistScripts(
      this.networkId as 0 | 1,
      blacklistMintBootstrap.txInput,
      blacklistMintBootstrap.adminPubKeyHash,
    );
    if (!this.fetcher) {
      throw new Error("Fetcher not initialized");
    }

    const blacklistUtxos = await fetcher.fetchAddressUTxOs(
      blacklistSpend.address,
    );
    if (!blacklistUtxos?.length) throw new Error("No blacklist UTxOs found");

    let nodeToReplace: UTxO | null = null;
    let preexistingNode: { key: string; next: string } | null = null;

    for (const utxo of blacklistUtxos) {
      if (!utxo.output.plutusData) continue;
      const datum = parseBlacklistDatum(
        deserializeDatum(utxo.output.plutusData),
      );
      if (!datum) continue;
      if (datum.key === targetStakingPkh)
        throw new Error("Target address is already blacklisted");
      if (
        datum.key.localeCompare(targetStakingPkh) < 0 &&
        targetStakingPkh.localeCompare(datum.next) < 0
      ) {
        nodeToReplace = utxo;
        preexistingNode = datum;
        break;
      }
    }

    if (!nodeToReplace || !preexistingNode)
      throw new Error("Could not find blacklist node to replace");

    const beforeNode = conStr0([
      byteString(preexistingNode.key),
      byteString(targetStakingPkh),
    ]);
    const afterNode = conStr0([
      byteString(targetStakingPkh),
      byteString(preexistingNode.next),
    ]);

    const mintRedeemer = conStr1([byteString(targetStakingPkh)]);
    const spendRedeemer = conStr0([]);
    const mintedAssets: Asset[] = [
      {
        unit: blacklistMint.policyId + targetStakingPkh,
        quantity: "1",
      },
    ];

    this.mesh.txEvaluationMultiplier = 1.3;
    this.mesh
      .spendingPlutusScriptV3()
      .txIn(nodeToReplace.input.txHash, nodeToReplace.input.outputIndex)
      .txInScript(blacklistSpend.cbor)
      .txInRedeemerValue(spendRedeemer, "JSON")
      .txInInlineDatumPresent()

      .mintPlutusScriptV3()
      .mint("1", blacklistMint.policyId, targetStakingPkh)
      .mintingScript(blacklistMint.cbor)
      .mintRedeemerValue(mintRedeemer, "JSON")

      .txOut(blacklistSpend.address, nodeToReplace.output.amount)
      .txOutInlineDatumValue(beforeNode, "JSON")

      .txOut(blacklistSpend.address, mintedAssets)
      .txOutInlineDatumValue(afterNode, "JSON")

      .requiredSignerHash(
        this.blacklistBootstrap.blacklistMintBootstrap.adminPubKeyHash,
      )
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(walletUtxos)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .changeAddress(changeAddress);

    return await this.mesh.complete();
  };

  whitelistAddress = async (targetAddress: string): Promise<string> => {
    const fetcher = this.fetcher;
    const { utxos: walletUtxos, walletAddress: changeAddress, collateral } =
      await this.getWalletInfoForTx();
    if (!fetcher)
      throw new Error("Fetcher or wallet not initialized");

    const targetAddr = deserializeAddress(targetAddress);
    const credentialsToRemove = targetAddr.asBase()?.getStakeCredential().hash;
    if (!credentialsToRemove)
      throw new Error("Target address must include a stake credential");

    if (!this.blacklistBootstrap)
      throw new Error("Blacklist bootstrap not initialized");
    const blacklistMintBootstrap =
      this.blacklistBootstrap.blacklistMintBootstrap;
    const { blacklistMint, blacklistSpend } = await buildBlacklistScripts(
      this.networkId as 0 | 1,
      blacklistMintBootstrap.txInput,
      blacklistMintBootstrap.adminPubKeyHash,
    );
    if (!this.fetcher) {
      throw new Error("Fetcher not initialized");
    }

    const blacklistUtxos = await fetcher.fetchAddressUTxOs(
      blacklistSpend.address,
    );
    if (!blacklistUtxos?.length) throw new Error("No blacklist UTxOs found");

    let nodeToRemove: UTxO | null = null;
    let nodeToRemoveDatum: { key: string; next: string } | null = null;
    let nodeToUpdate: UTxO | null = null;
    let nodeToUpdateDatum: { key: string; next: string } | null = null;

    for (const utxo of blacklistUtxos) {
      if (!utxo.output.plutusData) continue;
      const datum = parseBlacklistDatum(
        deserializeDatum(utxo.output.plutusData),
      );
      if (!datum) continue;
      if (datum.key === credentialsToRemove) {
        nodeToRemove = utxo;
        nodeToRemoveDatum = datum;
      }
      if (datum.next === credentialsToRemove) {
        nodeToUpdate = utxo;
        nodeToUpdateDatum = datum;
      }
      if (nodeToRemove && nodeToUpdate) break;
    }

    if (!nodeToRemove || !nodeToRemoveDatum)
      throw new Error(
        "Could not resolve relevant blacklist nodes (node to remove)",
      );
    if (!nodeToUpdate || !nodeToUpdateDatum)
      throw new Error(
        "Could not resolve relevant blacklist nodes (node to update)",
      );

    const newNext = nodeToRemoveDatum.next;
    const updatedNode = conStr0([
      byteString(nodeToUpdateDatum.key),
      byteString(newNext),
    ]);

    const mintRedeemer = conStr2([byteString(credentialsToRemove)]);
    const spendRedeemer = conStr0([]);

    this.mesh.txEvaluationMultiplier = 1.3;
    this.mesh
      .spendingPlutusScriptV3()
      .txIn(nodeToRemove.input.txHash, nodeToRemove.input.outputIndex)
      .txInScript(blacklistSpend.cbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(spendRedeemer, "JSON")

      .spendingPlutusScriptV3()
      .txIn(nodeToUpdate.input.txHash, nodeToUpdate.input.outputIndex)
      .txInScript(blacklistSpend.cbor)
      .txInInlineDatumPresent()
      .txInRedeemerValue(spendRedeemer, "JSON")

      .mintPlutusScriptV3()
      .mint("-1", blacklistMint.policyId, credentialsToRemove)
      .mintingScript(blacklistMint.cbor)
      .mintRedeemerValue(mintRedeemer, "JSON")

      .txOut(blacklistSpend.address, nodeToUpdate.output.amount)
      .txOutInlineDatumValue(updatedNode, "JSON")

      .requiredSignerHash(
        this.blacklistBootstrap.blacklistMintBootstrap.adminPubKeyHash,
      )
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(walletUtxos)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .changeAddress(changeAddress);

    return await this.mesh.complete();
  };

  seizeToken = async (
    unit: string,
    utxoTxHash: string,
    utxoOutputIndex: number,
    targetAddress: string,
    issuerAdminPkh: string,
  ): Promise<string> => {
    const params = this.params;
    const fetcher = this.fetcher;
    const wallet = this.wallet;
    if (!params || !fetcher || !wallet)
      throw new Error(
        "Contract parameters, fetcher, or wallet not initialized",
      );

    const policyId = unit.substring(0, POLICY_ID_LENGTH);
    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();

    const standardScript = new StandardScripts(this.networkId);
    const substandardScript = new SubStandardScripts(this.networkId);
    const programmableLogicBase =
      await standardScript.programmableLogicBase(params);
    const programmableLogicGlobal =
      await standardScript.programmableLogicGlobal(params);
    const registrySpend = await standardScript.registrySpend(params);

    const recipientSmartWallet = await getSmartWalletAddress(
      targetAddress,
      params,
      this.networkId as 0 | 1,
    );

    const feePayerUtxo = walletUtxos.find(
      (u) =>
        BigInt(
          u.output.amount.find((a) => a.unit === "lovelace")?.quantity ?? "0",
        ) > 10_000_000n,
    );
    if (!feePayerUtxo)
      throw new Error("No UTXO with enough ADA for fees found");

    const utxosAtRef = await fetcher.fetchUTxOs(utxoTxHash, utxoOutputIndex);
    const utxoToSeize = utxosAtRef?.[0];
    if (!utxoToSeize) throw new Error("Could not find utxo to seize");
    if (!utxoToSeize.output.plutusData)
      throw new Error("UTXO to seize must have inline datum");

    const totalInputs = 2; // feePayerUtxo + utxoToSeize
    const tokenAsset = utxoToSeize.output.amount.find((a) => a.unit === unit);
    if (!tokenAsset)
      throw new Error("UTXO does not contain the specified token");
    if (Number(tokenAsset.quantity) <= 0)
      throw new Error("UTXO token quantity must be greater than zero");

    const registryUtxos = await fetcher.fetchAddressUTxOs(
      registrySpend.address,
    );
    const progTokenRegistry = registryUtxos.find((utxo: UTxO) => {
      if (!utxo.output.plutusData) return false;
      const parsedDatum = parseRegistryDatum(
        deserializeDatum(utxo.output.plutusData),
      );
      return parsedDatum?.key === policyId;
    });
    if (!progTokenRegistry)
      throw new Error("Could not find registry entry for token");

    const protocolParamsUtxo = (
      await fetcher.fetchUTxOs(params.txHash, 0)
    )?.[0];
    if (!protocolParamsUtxo)
      throw new Error("Could not resolve protocol params");

    const compareUtxos = (a: UTxO, b: UTxO): number =>
      a.input.txHash !== b.input.txHash
        ? a.input.txHash.localeCompare(b.input.txHash)
        : a.input.outputIndex - b.input.outputIndex;

    const sortedRefInputs = [protocolParamsUtxo, progTokenRegistry].sort(
      compareUtxos,
    );
    const registryRefInputIndex = sortedRefInputs.findIndex(
      (r) =>
        r.input.txHash === progTokenRegistry.input.txHash &&
        r.input.outputIndex === progTokenRegistry.input.outputIndex,
    );
    if (registryRefInputIndex === -1)
      throw new Error("Could not find registry in sorted reference inputs");

    const programmableGlobalRedeemer = conStr1([
      integer(registryRefInputIndex),
      integer(1), // outputs_start_idx (skip recipient output)
      integer(totalInputs), // length_inputs
    ]);

    const seizedAssets: Asset[] = [
      { unit: "lovelace", quantity: "1500000" },
      { unit: unit, quantity: tokenAsset.quantity },
    ];
    const remainingAssets: Asset[] = utxoToSeize.output.amount.filter(
      (a) => a.unit !== unit,
    );
    if (remainingAssets.length === 0) {
      remainingAssets.push({ unit: "lovelace", quantity: "1000000" });
    }

    const substandardIssueAdmin =
      await substandardScript.issuerAdmin(issuerAdminPkh);

    this.mesh.txEvaluationMultiplier = 1.3;
    this.mesh
      .txIn(feePayerUtxo.input.txHash, feePayerUtxo.input.outputIndex)
      .spendingPlutusScriptV3()
      .txIn(utxoToSeize.input.txHash, utxoToSeize.input.outputIndex)
      .txInScript(programmableLogicBase.cbor)
      .txInRedeemerValue(conStr0([]), "JSON")
      .txInInlineDatumPresent()

      .withdrawalPlutusScriptV3()
      .withdrawal(substandardIssueAdmin.rewardAddress, "0")
      .withdrawalScript(substandardIssueAdmin.cbor)
      .withdrawalRedeemerValue(conStr0([]), "JSON")

      .withdrawalPlutusScriptV3()
      .withdrawal(programmableLogicGlobal.rewardAddress, "0")
      .withdrawalScript(programmableLogicGlobal.cbor)
      .withdrawalRedeemerValue(programmableGlobalRedeemer, "JSON")

      .txOut(recipientSmartWallet, seizedAssets)
      .txOutInlineDatumValue(conStr0([]), "JSON")

      .txOut(utxoToSeize.output.address, remainingAssets)
      .txOutInlineDatumValue(conStr0([]), "JSON");

    for (const refInput of sortedRefInputs) {
      this.mesh.readOnlyTxInReference(
        refInput.input.txHash,
        refInput.input.outputIndex,
      );
    }

    this.mesh
      .requiredSignerHash(issuerAdminPkh)
      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .selectUtxosFrom(walletUtxos)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .changeAddress(changeAddress);

    return await this.mesh.complete();
  };

  initializeBlacklist = async (): Promise<{
    txHex: string;
    bootstrap: BlacklistBootstrap;
  }> => {
    const params = this.params;
    const wallet = this.wallet;
    if (!params || !wallet)
      throw new Error("Contract parameters or wallet not initialized");

    const {
      utxos: walletUtxos,
      walletAddress: changeAddress,
      collateral,
    } = await this.getWalletInfoForTx();

    const utilityUtxos = walletUtxos.filter((utxo) => {
      const lovelaceAsset = utxo.output.amount.find(
        (a) => a.unit === "lovelace",
      );
      if (!lovelaceAsset) return false;
      const hasOnlyAda = utxo.output.amount.length === 1;
      const hasEnoughAda = Number(lovelaceAsset.quantity) >= 10_000_000;
      return hasOnlyAda && hasEnoughAda;
    });

    if (utilityUtxos.length === 0) {
      throw new Error("No suitable UTxOs found for bootstrap");
    }

    const bootstrapInput = utilityUtxos[0]!.input;

    const adminAddr = deserializeAddress(changeAddress);
    const adminPubKeyHash = adminAddr.asBase()?.getPaymentCredential().hash;
    if (!adminPubKeyHash) throw new Error("Could not resolve admin PKH");

    const standardScript = new StandardScripts(this.networkId);
    const substandardScript = new SubStandardScripts(this.networkId);

    const blacklistMint = await substandardScript.blacklistMint(
      bootstrapInput,
      adminPubKeyHash,
    );
    const blacklistMintPolicyId = blacklistMint.policyId;
    const blacklistSpend = await substandardScript.blacklistSpend(
      blacklistMintPolicyId,
    );
    const blacklistSpendAddress = blacklistSpend.address;

    const substandardIssueScript =
      await substandardScript.issuerAdmin(adminPubKeyHash);
    const substandardIssueAddress = substandardIssueScript.rewardAddress;

    const programmableLogicBase =
      await standardScript.programmableLogicBase(params);
    const programmableLogicbasePolicyId = programmableLogicBase.policyId;

    const blacklistInitDatum = conStr0([
      byteString(""),
      byteString(
        "ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
      ),
    ]);

    const blacklistAssets: Asset[] = [
      {
        unit: blacklistMintPolicyId,
        quantity: "1",
      },
    ];

    this.mesh.txEvaluationMultiplier = 1.3;
    this.mesh
      .txIn(bootstrapInput.txHash, bootstrapInput.outputIndex)
      .mintPlutusScriptV3()
      .mint("1", blacklistMintPolicyId, stringToHex(""))
      .mintingScript(blacklistMint.cbor)
      .mintRedeemerValue(conStr0([]), "JSON")

      .txOut(blacklistSpendAddress, blacklistAssets)
      .txOutInlineDatumValue(blacklistInitDatum, "JSON")

      .txInCollateral(collateral.input.txHash, collateral.input.outputIndex)
      .setNetwork(this.networkId === 0 ? "preview" : "mainnet")
      .selectUtxosFrom(utilityUtxos)
      .changeAddress(changeAddress);

    const txHex = await this.mesh.complete();

    const bootstrap: BlacklistBootstrap = {
      blacklistMintBootstrap: {
        txInput: bootstrapInput,
        adminPubKeyHash: adminPubKeyHash,
        scriptHash: blacklistMintPolicyId,
      },
      blacklistSpendBootstrap: {
        blacklistMintScriptHash: blacklistMintPolicyId,
        scriptHash: blacklistSpend.policyId,
      },
    };

    return { txHex, bootstrap };
  };
}
