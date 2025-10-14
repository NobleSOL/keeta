import React, { useEffect, useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import TokenSelector from "@/components/swap/TokenSelector";
import { Button } from "@/components/ui/button";
import { ArrowDownUp, Info } from "lucide-react";
import TokenLogo from "@/components/shared/TokenLogo";
import SlippageControl from "@/components/shared/SlippageControl";
import SlippageSettings from "@/components/shared/SlippageSettings";
import { tokenBySymbol } from "@/lib/tokens";
import { useAccount, useConnect, usePublicClient } from "wagmi";
import { useTokenList } from "@/hooks/useTokenList";
import { fetchOpenOceanQuoteBase, toWei, fromWei } from "@/aggregator/openocean";
import { ERC20_ABI } from "@/lib/erc20";
import { formatUnits } from "viem";

const TOKENS: Token[] = ["ETH", "USDC", "SBCK", "WBTC", "KTA"].map((sym) => ({
  ...tokenBySymbol(sym),
}));

export default function Index() {
  const [fromToken, setFromToken] = useState<Token>(tokenBySymbol("ETH"));
  const [toToken, setToToken] = useState<Token>(tokenBySymbol("SBCK"));
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");
  const [selecting, setSelecting] = useState<null | "from" | "to">(null);
  const [slippage, setSlippage] = useState<number>(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("slippagePct") : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  const canSwap = useMemo(() => {
    const a = Number(fromAmount);
    return Number.isFinite(a) && a > 0 && fromToken.symbol !== toToken.symbol;
  }, [fromAmount, fromToken.symbol, toToken.symbol]);

  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();

  const connectPreferred = () => {
    const preferred =
      connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (preferred) connect({ connector: preferred });
  };

  const cta = (() => {
    if (!isConnected)
      return { label: "Connect Wallet", disabled: false } as const;
    if (canSwap) return { label: "Swap", disabled: false } as const;
    return { label: "Enter an amount", disabled: true } as const;
  })();

  const { data: remoteTokens } = useTokenList();
  const publicClient = usePublicClient();
  const [quoteOut, setQuoteOut] = useState<null | { wei: bigint; formatted: string }>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [fromBalance, setFromBalance] = useState<number | undefined>(undefined);
  const [toBalance, setToBalance] = useState<number | undefined>(undefined);

  function resolveMeta(t: Token): { address: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"; decimals: number } | null {
    if (t.symbol.toUpperCase() === "ETH") return { address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", decimals: 18 };
    const byAddr = (remoteTokens || []).find((rt) => rt.address?.toLowerCase() === (t.address || "").toLowerCase());
    if (byAddr) return { address: byAddr.address, decimals: byAddr.decimals };
    const bySym = (remoteTokens || []).find((rt) => rt.symbol?.toUpperCase() === t.symbol.toUpperCase());
    if (bySym) return { address: bySym.address, decimals: bySym.decimals };
    if (t.address && t.decimals != null) return { address: t.address as any, decimals: t.decimals };
    return null;
  }

  useEffect(() => {
    let cancel = false;
    async function run() {
      setQuoteError(null);
      setQuoteOut(null);
      if (!canSwap || !publicClient) return;
      const inMeta = resolveMeta(fromToken);
      const outMeta = resolveMeta(toToken);
      if (!inMeta || !outMeta) return;
      try {
        setQuoting(true);
        const gasPrice = await publicClient.getGasPrice();
        const amountWei = toWei(fromAmount, inMeta.decimals);
        if (amountWei <= 0n) return;
        const q = await fetchOpenOceanQuoteBase({
          inTokenAddress: inMeta.address,
          outTokenAddress: outMeta.address,
          amountWei,
          gasPriceWei: gasPrice,
        });
        if (cancel) return;
        setQuoteOut({ wei: q.outAmountWei, formatted: fromWei(q.outAmountWei, outMeta.decimals) });
      } catch (e: any) {
        if (!cancel) setQuoteError(e?.message || String(e));
      } finally {
        if (!cancel) setQuoting(false);
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [canSwap, fromAmount, fromToken, toToken, remoteTokens, publicClient]);

  const handleFlip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-5">
          <section className="order-1 md:order-1 md:col-span-3">
            <div className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Swap</h1>
                <div className="text-xs text-muted-foreground">on Base</div>
              </div>
              <div className="space-y-3">
                <TokenInput
                  label="You pay"
                  token={fromToken}
                  amount={fromAmount}
                  onAmountChange={setFromAmount}
                  onTokenClick={() => setSelecting("from")}
                  balance={2.3456}
                />

                <div className="flex items-center justify-center py-1">
                  <Button
                    variant="secondary"
                    size="icon"
                    onClick={handleFlip}
                    aria-label="Switch tokens"
                  >
                    <ArrowDownUp />
                  </Button>
                </div>

                <TokenInput
                  label="You receive"
                  token={toToken}
                  amount={toAmount}
                  onAmountChange={setToAmount}
                  onTokenClick={() => setSelecting("to")}
                />
              </div>

              <div className="mt-4 rounded-xl border border-border/60 bg-secondary/60 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span>
                    {quoteOut && Number(fromAmount) > 0
                      ? `${(Number(quoteOut.formatted) / Number(fromAmount)).toFixed(6)} ${toToken.symbol}`
                      : quoting
                      ? "Fetching quote..."
                      : `–`}
                  </span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">Minimum received</span>
                  <SlippageSettings
                    value={slippage}
                    onChange={(v) => {
                      setSlippage(v);
                      if (typeof window !== "undefined") localStorage.setItem("slippagePct", String(v));
                    }}
                    className="text-right"
                  />
                </div>
                {quoteError && (
                  <div className="mt-2 text-xs text-red-400 break-words">{quoteError}</div>
                )}
              </div>

              <Button
                className="mt-4 h-12 w-full bg-brand text-white hover:bg-brand/90"
                disabled={cta.disabled}
                onClick={() => {
                  if (!isConnected) connectPreferred();
                }}
              >
                {cta.label}
              </Button>

            </div>
          </section>

          <aside className="order-2 md:order-2 md:col-span-2">
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                Trending on Base
              </h2>
              <ul className="space-y-3">
                {["ETH", "USDC", "KTA", "AERO", "SBCK"]
                  .map((s) => tokenBySymbol(s))
                  .map((t) => (
                    <li
                      key={t.symbol}
                      className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2"
                    >
                      <div className="flex items-center gap-2">
                        <TokenLogo
                          src={t.logo}
                          alt={`${t.name} logo`}
                          size={20}
                        />
                        <span className="font-medium">{t.symbol}</span>
                      </div>
                      <span className="text-xs text-emerald-400">
                        +{(Math.random() * 8 + 1).toFixed(1)}%
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
      {selecting && (
        <TokenSelector
          open={!!selecting}
          onClose={() => setSelecting(null)}
          onSelect={(t) => {
            if (selecting === "from") setFromToken(t);
            else setToToken(t);
          }}
        />
      )}
    </div>
  );
}
