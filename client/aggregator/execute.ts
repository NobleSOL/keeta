import { PublicClient } from "viem";
import { base } from "viem/chains";
import { DEFAULT_DEADLINE_SEC, FEE_BPS } from "@/aggregator/config";
import { ERC20_ABI } from "@/lib/erc20";
import {
  SwapBuildResult,
  fetch1inchSwap,
} from "@/aggregator/oneinch";

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
  onStatusChange?: (status: "checking" | "approving" | "confirming" | "complete") => void,
) {
  try {
    onStatusChange?.("checking");
    const current = (await pc.readContract({
      address: token,
      abi: ERC20_ABI,
      functionName: "allowance",
      args: [owner, spender],
    })) as bigint;
    console.log(`🔍 Current allowance: ${current.toString()}, needed: ${needed.toString()}`);
    if (current >= needed) {
      console.log("✅ Sufficient allowance already exists");
      onStatusChange?.("complete");
      return;
    }
  } catch (e) {
    console.warn("⚠️  Could not read allowance:", e);
  }

  console.log("📝 Requesting token approval...");
  onStatusChange?.("approving");
  const hash = await writeContractAsync({
    address: token,
    abi: ERC20_ABI,
    functionName: "approve",
    args: [spender, needed],
  });

  console.log(`⏳ Waiting for approval transaction: ${hash}`);
  onStatusChange?.("confirming");
  await pc.waitForTransactionReceipt({ hash: hash as `0x${string}` });
  console.log("✅ Approval confirmed");
  onStatusChange?.("complete");
}

function applyFee(amountIn: bigint): { net: bigint } {
  const fee = (amountIn * BigInt(FEE_BPS)) / 10_000n;
  return { net: amountIn - fee };
}

const UNIFIED_ROUTER_V2_ABI = [
  {
    type: "function",
    name: "swapExactTokensForTokens",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactETHForTokens",
    stateMutability: "payable",
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
  {
    type: "function",
    name: "swapExactTokensForETH",
    stateMutability: "nonpayable",
    inputs: [
      { name: "amountIn", type: "uint256" },
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    outputs: [{ name: "amounts", type: "uint256[]" }],
  },
] as const;

const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as Address;

export function v2RouterAddress(): Address | null {
  const v = (import.meta as any).env?.VITE_SB_V2_ROUTER as string | undefined;
  if (!v || !/^0x[a-fA-F0-9]{40}$/.test(v)) return null;
  return v as Address;
}

export async function executeSwapViaSilverbackV2(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  account: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps: number,
): Promise<{ txHash: string }> {
  // Use UnifiedRouter for fee collection
  const router = unifiedRouterAddress();
  console.log("🔍 Using UnifiedRouter address:", router);
  if (!router) throw new Error("Set VITE_SB_UNIFIED_ROUTER env to the deployed UnifiedRouter address");

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC);
  const isNativeIn = inToken.address === NATIVE_SENTINEL;
  const isNativeOut = outToken.address === NATIVE_SENTINEL;

  // Convert native sentinel to WETH for path
  const inAddr = isNativeIn ? WETH_ADDRESS : (inToken.address as Address);
  const outAddr = isNativeOut ? WETH_ADDRESS : (outToken.address as Address);
  const path = [inAddr, outAddr];

  // UnifiedRouter collects 0.3% fee automatically and routes through V2
  // We pass full amount - router deducts fee internally

  // Calculate minOut with slippage (applied to quoted output)
  const minOut = (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;

  let hash: string;

  if (isNativeIn) {
    // ETH -> Token swap
    hash = await writeContractAsync({
      address: router,
      abi: UNIFIED_ROUTER_V2_ABI,
      functionName: "swapExactETHForTokens",
      args: [minOut, path, account, deadline],
      value: amountIn, // Full amount (no fee deduction)
      chainId: base.id,
    });
  } else if (isNativeOut) {
    // Token -> ETH swap
    const inAddrForContract = inToken.address as Address;
    console.log("🔄 Token->ETH swap params:", {
      router,
      token: inAddrForContract,
      amountIn: amountIn.toString(),
      minOut: minOut.toString(),
      path,
      account,
      deadline: deadline.toString(),
    });

    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, router, amountIn);

    hash = await writeContractAsync({
      address: router,
      abi: UNIFIED_ROUTER_V2_ABI,
      functionName: "swapExactTokensForETH",
      args: [amountIn, minOut, path, account, deadline],
      chainId: base.id,
    });
  } else {
    // Token -> Token swap
    const inAddrForContract = inToken.address as Address;
    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, router, amountIn);

    hash = await writeContractAsync({
      address: router,
      abi: UNIFIED_ROUTER_V2_ABI,
      functionName: "swapExactTokensForTokens",
      args: [amountIn, minOut, path, account, deadline],
      chainId: base.id,
    });
  }

  return { txHash: hash as string };
}

export async function executeSwapVia1inch(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  account: Address,
  router: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps: number,
): Promise<{ txHash: string; swap1inch: SwapBuildResult | null }> {
  const { net, fee } = applyFee(amountIn);

  let swap1inch: SwapBuildResult;
  try {
    swap1inch = await fetch1inchSwap({
      inTokenAddress: inToken.address,
      outTokenAddress: outToken.address,
      amountWei: net,
      slippageBps,
      account,
    });
  } catch (error: any) {
    throw new Error(
      "1inch aggregation unavailable. " +
      "Please use tokens with Silverback V2 liquidity pools instead. " +
      "Original error: " + error.message
    );
  }

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
        target: swap1inch.to,
        data: swap1inch.data,
        deadline,
        sweep: true,
      },
    ],
    value: isNative ? net : 0n, // Send net amount (after fee) for ETH swaps
    chainId: base.id,
  });

  return { txHash: hash as string, swap1inch };
}
