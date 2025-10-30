import * as KeetaNet from "@keetanetwork/keetanet-client";

export const DEFAULT_NETWORK = process.env.KEETA_NETWORK || "test";
const RPC_URL =
  process.env.KEETA_RPC_URL || "https://rpc.test.keeta.network";

let clientPromise = null;

export const client = (() => {
  if (!clientPromise) {
    if (KeetaNet?.Client?.connect) {
      clientPromise = KeetaNet.Client.connect({
        network: DEFAULT_NETWORK,
        rpcUrl: RPC_URL,
      });
    } else if (KeetaNet?.Client?.fromNetwork) {
      clientPromise = Promise.resolve(
        KeetaNet.Client.fromNetwork(DEFAULT_NETWORK)
      );
    } else {
      clientPromise = Promise.reject(
        new Error("Keeta client factory not found")
      );
    }
  }
  return clientPromise;
})();

export async function getClient() {
  return client;
}
