import { PublicClient } from "viem";
import { v2Addresses } from "@/amm/v2";
import { FEE_BPS } from "@/aggregator/config";
import { fetchOpenOceanQuoteBase, QuoteResult } from "@/aggregator/openocean";

const PAIR_ABI = [
  { type: "function", name: "getReserves", stateMutability: "view", inputs: [], outputs: [
    { name: "reserve0", type: "uint112" },
    { name: "reserve1", type: "uint112" },
    { name: "blockTimestampLast", type: "uint32" },
  ] },
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ type: "address" }] },
] as const;

export type TokenMeta = {
  address: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  decimals: number;
};

export type AggregatedQuote = {
  venue: string;
  outAmountWei: bigint;
  feeTakenWei: bigint; // protocol fee taken from input
  details?: any;
};

function applyFee(amountIn: bigint): { net: bigint; fee: bigint } {
  const fee = (amountIn * BigInt(FEE_BPS)) / 10_000n;
  return { net: amountIn - fee, fee };
}

function getAmountOutV2(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
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
    const pair = await pc.readContract({
      address: addrs.factory,
      abi: [{ type: "function", name: "getPair", stateMutability: "view", inputs: [ { name: "tokenA", type: "address" }, { name: "tokenB", type: "address" } ], outputs: [{ type: "address" }] }] as const,
      functionName: "getPair",
      args: [inToken.address as `0x${string}`, outToken.address as `0x${string}`],
    }) as `0x${string}`;
    if (!pair || pair === "0x0000000000000000000000000000000000000000") return null;
    const [token0, token1] = await Promise.all([
      pc.readContract({ address: pair, abi: PAIR_ABI, functionName: "token0" }) as Promise<`0x${string}`>,
      pc.readContract({ address: pair, abi: PAIR_ABI, functionName: "token1" }) as Promise<`0x${string}`>,
    ]);
    const [r0, r1] = (await pc.readContract({ address: pair, abi: PAIR_ABI, functionName: "getReserves" })) as any as [bigint, bigint, number];
    const [reserveIn, reserveOut] = inToken.address === token0 ? [r0, r1] : [r1, r0];
    const out = getAmountOutV2(netIn, reserveIn, reserveOut);
    return { venue: "silverback-v2", outAmountWei: out, feeTakenWei: 0n };
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
  try {
    const res: QuoteResult = await fetchOpenOceanQuoteBase({
      inTokenAddress: inToken.address,
      outTokenAddress: outToken.address,
      amountWei: netIn,
      gasPriceWei,
    });
    return { venue: "openocean", outAmountWei: res.outAmountWei, feeTakenWei: 0n, details: res.dataRaw };
  } catch {
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
  if (candidates.length === 0) return { venue: "none", outAmountWei: 0n, feeTakenWei: fee, venueRaw: [] };
  const best = candidates.reduce((a, b) => (b.outAmountWei > a.outAmountWei ? b : a));
  return { ...best, feeTakenWei: fee, venueRaw: candidates };
}
