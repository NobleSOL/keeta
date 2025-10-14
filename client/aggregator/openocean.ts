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
  const toAmount = BigInt(json?.data?.outAmount || json?.data?.toAmount || json?.toAmount || 0);
  return { outAmountWei: toAmount, dataRaw: json };
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
