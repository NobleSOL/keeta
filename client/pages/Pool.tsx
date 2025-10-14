import React, { useEffect, useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import TokenSelector from "@/components/swap/TokenSelector";
import { Button } from "@/components/ui/button";
import { ArrowDownUp } from "lucide-react";
import { tokenBySymbol } from "@/lib/tokens";
import { useAccount, useConnect, usePublicClient } from "wagmi";
import SlippageControl from "@/components/shared/SlippageControl";
import SlippageSettings from "@/components/shared/SlippageSettings";
import { ERC20_ABI } from "@/lib/erc20";
import { formatUnits } from "viem";

export default function Pool() {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [tokenA, setTokenA] = useState<Token>({ ...tokenBySymbol("ETH") });
  const [tokenB, setTokenB] = useState<Token>({ ...tokenBySymbol("USDC") });
  const [amtA, setAmtA] = useState("");
  const [amtB, setAmtB] = useState("");
  const [selecting, setSelecting] = useState<null | "A" | "B">(null);
  const [slippage, setSlippage] = useState<number>(() => {
    const v =
      typeof window !== "undefined"
        ? localStorage.getItem("slippagePct")
        : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  useEffect(() => {
    const handler = () => {
      const v = typeof window !== "undefined" ? Number(localStorage.getItem("slippagePct") || "0.5") : 0.5;
      if (Number.isFinite(v)) setSlippage(v);
    };
    document.addEventListener("sb:slippage-updated", handler as any);
    return () => document.removeEventListener("sb:slippage-updated", handler as any);
  }, []);

  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const publicClient = usePublicClient();
  const [balA, setBalA] = useState<number | undefined>(undefined);
  const [balB, setBalB] = useState<number | undefined>(undefined);
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

  useEffect(() => {
    let cancel = false;
    async function getBalance(t: Token): Promise<number | undefined> {
      if (!publicClient || !address) return undefined;
      if (t.symbol.toUpperCase() === "ETH") {
        const bal = await publicClient.getBalance({ address });
        return Number(formatUnits(bal, 18));
      }
      const addr = (t.address as any) || undefined;
      const decimals = t.decimals ?? 18;
      if (!addr) return undefined;
      const bal = (await publicClient.readContract({
        address: addr,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      return Number(formatUnits(bal, decimals));
    }
    async function run() {
      setBalA(undefined);
      setBalB(undefined);
      if (!isConnected || !address) return;
      const [a, b] = await Promise.all([
        getBalance(tokenA),
        getBalance(tokenB),
      ]);
      if (cancel) return;
      setBalA(a);
      setBalB(b);
    }
    run();
    return () => {
      cancel = true;
    };
  }, [isConnected, address, tokenA, tokenB, publicClient]);

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
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
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
            <button
              type="button"
              className="text-xs text-sky-400 hover:underline"
              onClick={() => document.dispatchEvent(new Event("sb:open-slippage"))}
            >
              Slippage {slippage}%
            </button>
          </div>

          <div className="space-y-3">
            <TokenInput
              label={mode === "add" ? "Token A" : "Remove A"}
              token={tokenA}
              amount={amtA}
              onAmountChange={setAmtA}
              onTokenClick={() => setSelecting("A")}
              balance={balA}
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
              balance={balB}
            />
          </div>

          <div className="mt-4 rounded-xl border border-border/60 bg-secondary/60 p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Slippage</span>
              <SlippageSettings
                value={slippage}
                onChange={(v) => {
                  setSlippage(v);
                  if (typeof window !== "undefined")
                    localStorage.setItem("slippagePct", String(v));
                }}
              />
            </div>
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
