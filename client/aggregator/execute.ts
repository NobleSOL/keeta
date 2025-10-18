import { PublicClient } from "viem";
import { base } from "viem/chains";
import { DEFAULT_DEADLINE_SEC, FEE_BPS } from "@/aggregator/config";
import { ERC20_ABI } from "@/lib/erc20";
import {
  SwapBuildResult,
  fetchOpenOceanSwapBase,
} from "@/aggregator/openocean";

export type Address = `0x${string}`;
export type TokenMeta = {
  address: Address | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  decimals: number;
};

const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

const UNIFIED_ROUTER_ABI = [
  {
    type: "function",
    name: "swapAndForward",
    stateMutability: "payable",
    inputs: [
      {
        name: "p",
        type: "tuple",
        components: [
          { name: "inToken", type: "address" },
          { name: "outToken", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "minAmountOut", type: "uint256" },
          { name: "to", type: "address" },
          { name: "target", type: "address" },
          { name: "data", type: "bytes" },
          { name: "deadline", type: "uint256" },
          { name: "sweep", type: "bool" },
        ],
      },
    ],
    outputs: [],
  },
] as const;

export function unifiedRouterAddress(): Address | null {
  const v = (import.meta as any).env?.VITE_SB_UNIFIED_ROUTER as
    | string
    | undefined;
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  return v as Address;
}

export async function ensureAllowance(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  token: Address,
  owner: Address,
  spender: Address,
  needed: bigint,
) {
  try {
    const current = (await pc.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
    if (current >= needed) return;
  } catch {
    // Proceed to try approve anyway
  }
  await writeContractAsync({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, needed],
  });
}

function applyFee(amountIn: bigint): { net: bigint } {
  const fee = (amountIn * BigInt(FEE_BPS)) / 10_000n;
  return { net: amountIn - fee };
}

export async function executeSwapViaOpenOcean(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  account: Address,
  router: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps: number,
): Promise<{ txHash: string; oo: SwapBuildResult }> {
  const gasPriceWei = await pc.getGasPrice();
  const { net } = applyFee(amountIn);
  const oo = await fetchOpenOceanSwapBase({
    inTokenAddress: inToken.address,
    outTokenAddress: outToken.address,
    amountWei: net,
    slippageBps,
    account,
    gasPriceWei,
  });

  const minOut = (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;
  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC);
  const isNative = inToken.address === NATIVE_SENTINEL;
  const inAddrForContract = isNative ? (ZERO_ADDRESS as Address) : (inToken.address as Address);

  if (!isNative) {
    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, router, amountIn);
  }

  const hash = await writeContractAsync({
    address: router,
    abi: UNIFIED_ROUTER_ABI,
    functionName: "swapAndForward",
    args: [
      {
        inToken: inAddrForContract,
        outToken: outToken.address as Address,
        amountIn,
        minAmountOut: minOut,
        to: account,
        target: oo.to,
        data: oo.data,
        deadline,
        sweep: true,
      },
    ],
    value: isNative ? amountIn : 0n,
    chainId: base.id,
  });

  return { txHash: hash as string, oo };
}
