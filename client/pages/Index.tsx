import { useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import { Button } from "@/components/ui/button";
import { ArrowDownUp, Info } from "lucide-react";

const TOKENS: Token[] = [
  { symbol: "ETH", name: "Ether" },
  { symbol: "USDC", name: "USD Coin" },
  { symbol: "SIV", name: "Siverback" },
  { symbol: "WBTC", name: "Wrapped BTC" },
];

export default function Index() {
  const [fromToken, setFromToken] = useState<Token>(TOKENS[0]);
  const [toToken, setToToken] = useState<Token>(TOKENS[2]);
  const [fromAmount, setFromAmount] = useState("");
  const [toAmount, setToAmount] = useState("");

  const canSwap = useMemo(() => {
    const a = Number(fromAmount);
    return Number.isFinite(a) && a > 0 && fromToken.symbol !== toToken.symbol;
  }, [fromAmount, fromToken.symbol, toToken.symbol]);

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
          <section className="order-2 md:order-1 md:col-span-3">
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
                  onTokenClick={() => {
                    const idx = (TOKENS.findIndex((t) => t.symbol === fromToken.symbol) + 1) % TOKENS.length;
                    setFromToken(TOKENS[idx]);
                  }}
                  balance={2.3456}
                />

                <div className="flex items-center justify-center py-1">
                  <Button variant="secondary" size="icon" onClick={handleFlip} aria-label="Switch tokens">
                    <ArrowDownUp />
                  </Button>
                </div>

                <TokenInput
                  label="You receive"
                  token={toToken}
                  amount={toAmount}
                  onAmountChange={setToAmount}
                  onTokenClick={() => {
                    const idx = (TOKENS.findIndex((t) => t.symbol === toToken.symbol) + 1) % TOKENS.length;
                    setToToken(TOKENS[idx]);
                  }}
                />
              </div>

              <div className="mt-4 rounded-xl border border-border/60 bg-secondary/60 p-4 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Price</span>
                  <span>1 {fromToken.symbol} ≈ 2000 {toToken.symbol}</span>
                </div>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-muted-foreground">Slippage</span>
                  <span>0.50%</span>
                </div>
              </div>

              <Button className="mt-4 h-12 w-full bg-brand text-brand-foreground hover:bg-brand/90" disabled={!canSwap}>
                {canSwap ? "Swap" : "Enter an amount"}
              </Button>

              <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                <Info className="size-4" />
                Quotes are simulated for demo. Plug your DEX logic and wallet to enable real swaps.
              </p>
            </div>
          </section>

          <aside className="order-1 md:order-2 md:col-span-2">
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">Trending on Base</h2>
              <ul className="space-y-3">
                {["ETH", "USDC", "AERO", "DEGEN", "SIV"].map((t) => (
                  <li key={t} className="flex items-center justify-between rounded-lg bg-secondary/40 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="size-5 rounded-full bg-muted" />
                      <span className="font-medium">{t}</span>
                    </div>
                    <span className="text-xs text-emerald-400">+{(Math.random() * 8 + 1).toFixed(1)}%</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
