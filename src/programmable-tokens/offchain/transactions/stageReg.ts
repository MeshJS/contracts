import { MeshTxBuilder } from "@meshsdk/core";

import { provider, wallet } from "../../config";
import cip113_scripts_subStandard from "../deployment/subStandard";

export const RegisterIssue = async (Network_id: 0 | 1) => {
  const changeAddress = await wallet.getChangeAddress();
  const walletUtxos = await wallet.getUtxos();
  const collateral = (await wallet.getCollateral())[0];
  const substandardScript = new cip113_scripts_subStandard(Network_id);
  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const substandard_issue = await substandardScript.transfer_issue_withdraw();

  const unsignedTx = await txBuilder
    .registerStakeCertificate(substandard_issue.address)
    .selectUtxosFrom(walletUtxos)
    .txInCollateral(collateral!.input.txHash, collateral!.input.outputIndex)
    .setNetwork("preview")
    .changeAddress(changeAddress)
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);
  return await wallet.submitTx(signedTx);
};

export const RegisterTransfer = async (Network_id: 0 | 1) => {
  const changeAddress = await wallet.getChangeAddress();
  const walletUtxos = await wallet.getUtxos();
  const collateral = (await wallet.getCollateral())[0];

  const substandardScript = new cip113_scripts_subStandard(Network_id);
  const txBuilder = new MeshTxBuilder({
    fetcher: provider,
    submitter: provider,
  });

  const substandard_transfer =
    await substandardScript.transfer_transfer_withdraw();

  const unsignedTx = await txBuilder
    .registerStakeCertificate(substandard_transfer.reward_address)
    .txInCollateral(collateral!.input.txHash, collateral!.input.outputIndex)
    .setNetwork("preview")
    .selectUtxosFrom(walletUtxos)
    .changeAddress(changeAddress)
    .complete();

  const signedTx = await wallet.signTx(unsignedTx);
  return await wallet.submitTx(signedTx);
};
