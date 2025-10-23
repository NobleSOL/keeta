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

  // Debug log the raw response
  console.log('OpenOcean quote response:', {
    inToken: inTokenAddress,
    outToken: outTokenAddress,
    rawOutAmount: json?.data?.outAmount || json?.data?.toAmount || json?.toAmount,
    fullData: json?.data
  });

  let toAmount = BigInt(
    json?.data?.outAmount || json?.data?.toAmount || json?.toAmount || 0,
  );

  // CRITICAL FIX: OpenOcean returns USDC amounts with 18 decimals instead of 6
  // We need to correct this by dividing by 10^12 for USDC on Base mainnet
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
  if (outTokenAddress.toLowerCase() === USDC_BASE) {
    const originalAmount = toAmount;
    console.log('🔍 USDC amount before correction:', {
      original: originalAmount.toString(),
      originalLength: originalAmount.toString().length,
      willDivideBy: '10^12'
    });
    toAmount = toAmount / (10n ** 12n);
    console.log('✅ USDC amount after correction:', {
      corrected: toAmount.toString(),
      correctedLength: toAmount.toString().length
    });
  }

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
    throw new Error(`OpenOcean API error (${res.status}): ${text}`);
  }
  const json = await res.json();

  // Debug log to see actual response
  console.log("OpenOcean swap response:", json);

  // Handle error responses from OpenOcean
  if (json.code !== 200 && json.code !== undefined) {
    throw new Error(`OpenOcean: ${json.error || json.message || 'Unknown error'}`);
  }

  const data = json?.data || json;
  const to = (data?.to || data?.tx?.to) as `0x${string}`;
  const dataHex = (data?.data || data?.tx?.data) as `0x${string}`;
  const valueRaw = data?.value ?? data?.tx?.value ?? "0";
  let outAmount = BigInt(
    data?.outAmount || data?.toAmount || data?.amountOut || 0,
  );

  // CRITICAL FIX: OpenOcean returns USDC amounts with 18 decimals instead of 6
  const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase();
  if (outTokenAddress.toLowerCase() === USDC_BASE) {
    console.log('⚠️  Correcting OpenOcean USDC decimal bug in swap build: dividing by 10^12');
    outAmount = outAmount / (10n ** 12n);
  }

  if (!to || !dataHex) {
    console.error("OpenOcean response missing fields:", {
      to,
      dataHex,
      fullResponse: json
    });
    throw new Error("OpenOcean: No liquidity found or testnet not supported. Try using Silverback V2 pairs.");
  }

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
