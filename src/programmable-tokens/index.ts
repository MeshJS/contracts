import { wallet } from "./config";
import params from "./offchain/protocol.json";
import { bootstrapProtocol, splitWallet } from "./offchain/transactions/protocolParamMint";
import { register_programmable_token } from "./offchain/transactions/registration";
import { transfer_programmable_token } from "./offchain/transactions/transfer";
import { ProtocolBootstrapParams } from "./offchain/types";

const params_new = params as ProtocolBootstrapParams;

// if(!params_new.issuanceParams.scriptHash){
//     throw new Error("Issuance script hash is required");
// }
//const mint = await mint_programmable_tokens(params_new, "test3","100000", 0);

// const mint = await transfer_programmable_token(
//   "8428ae12aba2b64dc79b1c09d49b753852fe5bb544d1f4104eeb0c6c7465737433",
//   "10",
//   "addr_test1qq7uufq87mnxnlpssz63xpj4k0hze92shw27s2enmmdfquvcdyyfvue3t9sqyyg4ys887qkdznwj6d96tn672agd62as3gch4t",
//   params_new,
//   0,
// );
// const mint = await register_programmable_token("test3", "100000", params_new, "issuance", 0);
//const mint = await bootstrapProtocol(0, "addr_test1qq7uufq87mnxnlpssz63xpj4k0hze92shw27s2enmmdfquvcdyyfvue3t9sqyyg4ys887qkdznwj6d96tn672agd62as3gch4t");
const mint = await splitWallet(wallet,await wallet.getChangeAddress());
console.log("mint:", mint);
