import { PublicClient } from "viem";
import { v2Addresses } from "@/amm/v2";
import { FEE_BPS } from "@/aggregator/config";
import { fetchOpenOceanQuoteBase, QuoteResult } from "@/aggregator/openocean";

const PAIR_ABI = [
  {
    type: "function",
    name: "getReserves",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "reserve0", type: "uint112" },
      { name: "reserve1", type: "uint112" },
      { name: "blockTimestampLast", type: "uint32" },
    ],
  },
  {
    type: "function",
    name: "token0",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ type: "address" }],
  },
] as const;

export type TokenMeta = {
  address: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  decimals: number;
};

export type AggregatedQuote = {
  venue: string;
  outAmountWei: bigint;
  feeTakenWei: bigint; // protocol fee taken from input
  priceImpact?: number; // percentage (e.g., 1.5 = 1.5%)
  details?: any;
};

function applyFee(amountIn: bigint): { net: bigint; fee: bigint } {
  const fee = (amountIn * BigInt(FEE_BPS)) / 10_000n;
  return { net: amountIn - fee, fee };
}

function getAmountOutV2(
  amountIn: bigint,
  reserveIn: bigint,
  reserveOut: bigint,
): bigint {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return 0n;
  const amountInWithFee = amountIn * 997n;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * 1000n + amountInWithFee;
  return numerator / denominator;
}

async function quoteLocalV2(
  pc: PublicClient,
  inToken: TokenMeta,
  outToken: TokenMeta,
  netIn: bigint,
): Promise<AggregatedQuote | null> {
  const addrs = v2Addresses();
  if (!addrs) return null;
  try {
    // Convert ETH sentinel to WETH for pair lookup
    const WETH_ADDRESS = "0x4200000000000000000000000000000000000006" as `0x${string}`;
    const NATIVE_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

    const inAddr = inToken.address === NATIVE_SENTINEL ? WETH_ADDRESS : (inToken.address as `0x${string}`);
    const outAddr = outToken.address === NATIVE_SENTINEL ? WETH_ADDRESS : (outToken.address as `0x${string}`);

    const pair = (await pc.readContract({
      address: addrs.factory,
      abi: [
        {
          type: "function",
          name: "getPair",
          stateMutability: "view",
          inputs: [
            { name: "tokenA", type: "address" },
            { name: "tokenB", type: "address" },
          ],
          outputs: [{ type: "address" }],
        },
      ] as const,
      functionName: "getPair",
      args: [inAddr, outAddr],
    })) as `0x${string}`;

    if (!pair || pair === "0x0000000000000000000000000000000000000000")
      return null;

    const [token0, token1] = await Promise.all([
      pc.readContract({
        address: pair,
        abi: PAIR_ABI,
        functionName: "token0",
      }) as Promise<`0x${string}`>,
      pc.readContract({
        address: pair,
        abi: PAIR_ABI,
        functionName: "token1",
      }) as Promise<`0x${string}`>,
    ]);

    const [r0, r1] = (await pc.readContract({
      address: pair,
      abi: PAIR_ABI,
      functionName: "getReserves",
    })) as any as [bigint, bigint, number];

    const [reserveIn, reserveOut] =
      inAddr === token0 ? [r0, r1] : [r1, r0];
    const out = getAmountOutV2(netIn, reserveIn, reserveOut);

    // Calculate price impact
    // Expected price (no slippage): reserveOut / reserveIn
    // Actual price: out / netIn
    // Impact = (1 - (actualPrice / expectedPrice)) * 100
    const expectedPrice = (reserveOut * 10000n) / reserveIn;
    const actualPrice = (out * 10000n) / netIn;
    const priceImpact = expectedPrice > 0n
      ? Number((10000n - (actualPrice * 10000n) / expectedPrice)) / 100
      : 0;

    return {
      venue: "silverback-v2",
      outAmountWei: out,
      feeTakenWei: 0n,
      priceImpact: Math.max(0, priceImpact), // Ensure non-negative
    };
  } catch {
    return null;
  }
}

async function quoteOpenOcean(
  pc: PublicClient,
  inToken: TokenMeta,
  outToken: TokenMeta,
  netIn: bigint,
  gasPriceWei: bigint,
): Promise<AggregatedQuote | null> {
  // Skip OpenOcean for KTA token - known to return stub calldata
  const KTA_ADDRESS = "0xc0634090F2Fe6c6d75e61Be2b949464aBB498973";
  if (inToken.address.toLowerCase() === KTA_ADDRESS.toLowerCase() ||
      outToken.address.toLowerCase() === KTA_ADDRESS.toLowerCase()) {
    console.log('⏭️  Skipping OpenOcean for KTA token, using Silverback V2');
    return null;
  }

  try {
    const res: QuoteResult = await fetchOpenOceanQuoteBase({
      inTokenAddress: inToken.address,
      outTokenAddress: outToken.address,
      amountWei: netIn,
      gasPriceWei,
    });

    // Sanity check: Reject quotes that are suspiciously small (< 0.0001% of input)
    // This indicates OpenOcean doesn't actually have a good route
    // Example: 1 ETH in should get at least 0.000001 ETH equivalent out
    const minReasonableOutput = netIn / 1_000_000n; // 0.0001% of input
    if (res.outAmountWei < minReasonableOutput) {
      console.warn('⚠️  OpenOcean quote rejected: output too small', {
        inAmount: netIn.toString(),
        outAmount: res.outAmountWei.toString(),
        minExpected: minReasonableOutput.toString(),
      });
      return null;
    }

    return {
      venue: "openocean",
      outAmountWei: res.outAmountWei,
      feeTakenWei: 0n,
      details: res.dataRaw,
    };
  } catch (error) {
    console.warn('OpenOcean quote failed:', error);
    return null;
  }
}

export async function getBestAggregatedQuote(
  pc: PublicClient,
  inToken: TokenMeta,
  outToken: TokenMeta,
  amountIn: bigint,
  gasPriceWei: bigint,
): Promise<AggregatedQuote & { venueRaw: AggregatedQuote[] }> {
  const { net, fee } = applyFee(amountIn);
  const quotes = await Promise.all([
    quoteOpenOcean(pc, inToken, outToken, net, gasPriceWei),
    quoteLocalV2(pc, inToken, outToken, net),
  ]);
  const candidates = quotes.filter(Boolean) as AggregatedQuote[];
  if (candidates.length === 0)
    return { venue: "none", outAmountWei: 0n, feeTakenWei: fee, venueRaw: [] };
  const best = candidates.reduce((a, b) =>
    b.outAmountWei > a.outAmountWei ? b : a,
  );
  return { ...best, feeTakenWei: fee, venueRaw: candidates };
}
