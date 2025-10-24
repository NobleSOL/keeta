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

function applyFee(amountIn: bigint): { net: bigint; fee: bigint } {
  const fee = (amountIn * BigInt(FEE_BPS)) / 10_000n;
  return { net: amountIn - fee, fee };
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

export async function executeSwapViaOpenOcean(
  pc: PublicClient,
  writeContractAsync: (args: any) => Promise<any>,
  account: Address,
  routerAddress: Address,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  quotedOut: bigint,
  slippageBps: number,
): Promise<{ txHash: string; swapOpenOcean: SwapBuildResult | null }> {
  const { net, fee } = applyFee(amountIn);

  let swapOpenOcean: SwapBuildResult;
  try {
    // CRITICAL: Pass router address, not user address!
    // OpenOcean needs to know the actual caller (router) so it returns tokens to the router
    swapOpenOcean = await fetchOpenOceanSwapBase({
      inTokenAddress: inToken.address,
      outTokenAddress: outToken.address,
      amountWei: net,
      slippageBps,
      account: routerAddress, // Use router address, not user address
      gasPriceWei: await pc.getGasPrice(),
    });

    // Validate calldata length - short calldata indicates no real route exists
    // Normal swaps have 200+ bytes of calldata, stub routes have ~68 bytes
    if (swapOpenOcean.data.length < 100) {
      console.warn('⚠️  OpenOcean swap rejected: calldata too short (no real route)', {
        dataLength: swapOpenOcean.data.length,
        data: swapOpenOcean.data,
      });
      throw new Error("OpenOcean: No liquidity available for this swap route");
    }
  } catch (error: any) {
    throw new Error(
      "OpenOcean aggregation unavailable. " +
      "Please use tokens with Silverback V2 liquidity pools instead. " +
      "Original error: " + error.message
    );
  }

  // Use OpenOcean's actual outAmount for minOut calculation, with additional buffer for execution variance
  // OpenOcean applies slippage, but we add safety margin for price movement and routing differences
  const baseMinOut = swapOpenOcean.outAmountWei && swapOpenOcean.outAmountWei > 0n
    ? swapOpenOcean.outAmountWei
    : (quotedOut * BigInt(10_000 - slippageBps)) / 10_000n;

  // Apply 15% additional buffer to prevent reverts from price movements and aggregator variance
  // Aggregator quotes are estimates - actual output can vary significantly based on liquidity and routing at execution time
  // Increased from 5% to 15% to handle volatile/illiquid tokens better
  const minOut = (baseMinOut * 8500n) / 10_000n;

  console.log("🔍 OpenOcean swap execution params:", {
    amountIn: amountIn.toString(),
    net: net.toString(),
    fee: fee.toString(),
    quotedOut: quotedOut.toString(),
    openOceanOutAmountWei: swapOpenOcean.outAmountWei?.toString(),
    calculatedMinOut: minOut.toString(),
    slippageBps,
    target: swapOpenOcean.to,
  });

  const deadline = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_DEADLINE_SEC);
  const isNative = inToken.address === NATIVE_SENTINEL;
  const inAddrForContract = isNative ? (ZERO_ADDRESS as Address) : (inToken.address as Address);

  if (!isNative) {
    await ensureAllowance(pc, writeContractAsync, inAddrForContract, account, routerAddress, amountIn);
  }

  const hash = await writeContractAsync({
    address: routerAddress,
    abi: UNIFIED_ROUTER_ABI,
    functionName: "swapAndForward",
    args: [
      {
        inToken: inAddrForContract,
        outToken: outToken.address as Address,
        amountIn,
        minAmountOut: minOut,
        to: account,
        target: swapOpenOcean.to,
        data: swapOpenOcean.data,
        deadline,
        sweep: true,
      },
    ],
    value: isNative ? amountIn : 0n, // Send full amount - router deducts fee internally
    chainId: base.id,
  });

  return { txHash: hash as string, swapOpenOcean };
}
