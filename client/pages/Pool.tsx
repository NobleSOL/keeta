import { useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import TokenSelector from "@/components/swap/TokenSelector";
import { Button } from "@/components/ui/button";
import { ArrowDownUp } from "lucide-react";
import { tokenBySymbol } from "@/lib/tokens";
import { useAccount, useConnect } from "wagmi";
import SlippageControl from "@/components/shared/SlippageControl";

export default function Pool() {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [tokenA, setTokenA] = useState<Token>({ ...tokenBySymbol("ETH") });
  const [tokenB, setTokenB] = useState<Token>({ ...tokenBySymbol("USDC") });
  const [amtA, setAmtA] = useState("");
  const [amtB, setAmtB] = useState("");
  const [selecting, setSelecting] = useState<null | "A" | "B">(null);
  const [slippage, setSlippage] = useState<number>(() => {
    const v = typeof window !== "undefined" ? localStorage.getItem("slippagePct") : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  const { isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const connectPreferred = () => {
    const preferred =
      connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (preferred) connect({ connector: preferred });
  };

  const canSubmit = useMemo(() => {
    const a = Number(amtA);
    const b = Number(amtB);
    if (mode === "add")
      return a > 0 && b > 0 && tokenA.symbol !== tokenB.symbol;
    return a > 0 || b > 0; // for remove, one input can drive percentage or amounts
  }, [amtA, amtB, mode, tokenA.symbol, tokenB.symbol]);

  const cta = (() => {
    if (!isConnected)
      return { label: "Connect Wallet", disabled: false } as const;
    if (canSubmit)
      return {
        label: mode === "add" ? "Add Liquidity" : "Remove Liquidity",
        disabled: false,
      } as const;
    return {
      label: mode === "add" ? "Enter amounts" : "Enter amount",
      disabled: true,
    } as const;
  })();

  const handleFlip = () => {
    setTokenA(tokenB);
    setTokenB(tokenA);
    setAmtA(amtB);
    setAmtB(amtA);
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-10">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="mb-4 flex items-center gap-2">
            <button
              onClick={() => setMode("add")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${mode === "add" ? "bg-brand text-white" : "bg-secondary/60"}`}
            >
              Add
            </button>
            <button
              onClick={() => setMode("remove")}
              className={`rounded-full px-4 py-2 text-sm font-medium ${mode === "remove" ? "bg-brand text-white" : "bg-secondary/60"}`}
            >
              Remove
            </button>
          </div>

          <div className="space-y-3">
            <TokenInput
              label={mode === "add" ? "Token A" : "Remove A"}
              token={tokenA}
              amount={amtA}
              onAmountChange={setAmtA}
              onTokenClick={() => setSelecting("A")}
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
              label={mode === "add" ? "Token B" : "Remove B"}
              token={tokenB}
              amount={amtB}
              onAmountChange={setAmtB}
              onTokenClick={() => setSelecting("B")}
            />
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

          <p className="mt-3 text-xs text-muted-foreground">
            Select tokens or paste a contract address to manage liquidity.
          </p>
        </div>
      </div>

      {selecting && (
        <TokenSelector
          open={!!selecting}
          onClose={() => setSelecting(null)}
          onSelect={(t) => {
            if (selecting === "A") setTokenA(t);
            else setTokenB(t);
          }}
        />
      )}
    </div>
  );
}
