import { V3_POSITION_MANAGER, isAddress } from "./config";
import type { Address } from "viem";

// Minimal NFPM subset
export const nfpmAbi = [
  {
    type: "function",
    name: "createAndInitializePoolIfNecessary",
    stateMutability: "payable",
    inputs: [
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "sqrtPriceX96", type: "uint160" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

export function v3Address() {
  if (!isAddress(V3_POSITION_MANAGER)) return null;
  return V3_POSITION_MANAGER as Address;
}
