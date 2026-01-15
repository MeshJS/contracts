import { BlockfrostProvider, MeshWallet } from "@meshsdk/core";

const SEED_PHRASE = "sorry wide bean ancient recall idle coral door supply menu guide transfer swift ticket metal across citizen atom differ supply into pudding file off";

const words = SEED_PHRASE.split(" ");
export const provider = new BlockfrostProvider("previewYMKfBQAXAIel1SKsLp8Beu2pA8By8VHT");
export const wallet = new MeshWallet({
  fetcher: provider,
  submitter: provider,
  networkId: 0,
  key: {
    type: "mnemonic",
    words: words,
  },
});
