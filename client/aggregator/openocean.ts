import { parseUnits, formatUnits } from "viem";

export type QuoteParams = {
  inTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  outTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  amountWei: bigint;
  gasPriceWei: bigint;
};

export type QuoteResult = {
  outAmountWei: bigint;
  dataRaw: any;
};

export async function fetchOpenOceanQuoteBase({
  inTokenAddress,
  outTokenAddress,
  amountWei,
  gasPriceWei,
}: QuoteParams): Promise<QuoteResult> {
  const qs = new URLSearchParams({
    inTokenAddress,
    outTokenAddress,
    amount: amountWei.toString(),
    gasPrice: gasPriceWei.toString(),
  });
  const url = `https://open-api.openocean.finance/v4/base/quote?${qs.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenOcean quote failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const toAmount = BigInt(
    json?.data?.outAmount || json?.data?.toAmount || json?.toAmount || 0,
  );
  return { outAmountWei: toAmount, dataRaw: json };
}

export type SwapBuildParams = {
  inTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  outTokenAddress: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
  amountWei: bigint;
  slippageBps: number; // e.g. 50 -> 0.50%
  account: `0x${string}`;
  gasPriceWei: bigint;
};

export type SwapBuildResult = {
  to: `0x${string}`;
  data: `0x${string}`;
  value: bigint;
  outAmountWei?: bigint;
  raw: any;
};

export async function fetchOpenOceanSwapBase({
  inTokenAddress,
  outTokenAddress,
  amountWei,
  slippageBps,
  account,
  gasPriceWei,
}: SwapBuildParams): Promise<SwapBuildResult> {
  const slippagePct = (slippageBps / 100).toString();
  const qs = new URLSearchParams({
    inTokenAddress,
    outTokenAddress,
    amount: amountWei.toString(),
    slippage: slippagePct,
    account,
    gasPrice: gasPriceWei.toString(),
  });
  const url = `https://open-api.openocean.finance/v4/base/swap?${qs.toString()}`;
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenOcean swap build failed: ${res.status} ${text}`);
  }
  const json = await res.json();
  const data = json?.data || json;
  const to = (data?.to || data?.tx?.to) as `0x${string}`;
  const dataHex = (data?.data || data?.tx?.data) as `0x${string}`;
  const valueRaw = data?.value ?? data?.tx?.value ?? "0";
  const outAmount = BigInt(
    data?.outAmount || data?.toAmount || data?.amountOut || 0,
  );
  if (!to || !dataHex) throw new Error("OpenOcean swap build missing to/data");
  const value = (() => {
    try {
      return BigInt(valueRaw);
    } catch {
      return 0n;
    }
  })();
  return { to, data: dataHex, value, outAmountWei: outAmount, raw: json };
}

export function toWei(amount: string, decimals: number): bigint {
  try {
    return parseUnits(amount || "0", decimals);
  } catch {
    return 0n;
  }
}

export function fromWei(amount: bigint, decimals: number): string {
  return formatUnits(amount, decimals);
}
