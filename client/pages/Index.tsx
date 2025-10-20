import React, { useEffect, useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import TokenSelector from "@/components/swap/TokenSelector";
import { Button } from "@/components/ui/button";
import { ArrowDownUp } from "lucide-react";
import TrendingPills from "@/components/shared/TrendingPills";
import QuickFill from "@/components/shared/QuickFill";
import { tokenBySymbol } from "@/lib/tokens";
import { useAccount, useConnect, usePublicClient, useWriteContract } from "wagmi";
import { useTokenList } from "@/hooks/useTokenList";
import { toWei, fromWei } from "@/aggregator/openocean";
import { getBestAggregatedQuote } from "@/aggregator/engine";
import { ERC20_ABI } from "@/lib/erc20";
import { formatUnits } from "viem";
import { baseSepolia } from "viem/chains";
import { executeSwapViaOpenOcean, executeSwapViaSilverbackV2, unifiedRouterAddress } from "@/aggregator/execute";
import { toast } from "@/hooks/use-toast";

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
    const v =
      typeof window !== "undefined"
        ? localStorage.getItem("slippagePct")
        : null;
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : 0.5;
  });

  const canSwap = useMemo(() => {
    const a = Number(fromAmount);
    return Number.isFinite(a) && a > 0 && fromToken.symbol !== toToken.symbol;
  }, [fromAmount, fromToken.symbol, toToken.symbol]);

  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();

  const connectPreferred = () => {
    const preferred =
      connectors.find((c) => c.id === "injected") ?? connectors[0];
    if (preferred) connect({ connector: preferred, chainId: baseSepolia.id });
  };

  const cta = (() => {
    if (!isConnected)
      return { label: "Connect Wallet", disabled: false } as const;
    if (swapStatus !== "idle") {
      const statusLabels = {
        checking: "Checking allowance...",
        approving: "Approve in wallet...",
        confirming: "Confirming approval...",
        swapping: "Swap in wallet...",
        waiting: "Confirming swap...",
        idle: "Swap",
      };
      return { label: statusLabels[swapStatus], disabled: true } as const;
    }
    if (canSwap) return { label: isWriting ? "Processing..." : "Swap", disabled: isWriting } as const;
    return { label: "Enter an amount", disabled: true } as const;
  })();

  const [swapStatus, setSwapStatus] = useState<"idle" | "checking" | "approving" | "confirming" | "swapping" | "waiting">("idle");

  const { data: remoteTokens } = useTokenList();
  const publicClient = usePublicClient();
  const [quoteOut, setQuoteOut] = useState<null | {
    wei: bigint;
    formatted: string;
    venue?: string;
    feeWei?: bigint;
    priceImpact?: number;
  }>(null);
  const [quoting, setQuoting] = useState(false);
  const [quoteError, setQuoteError] = useState<string | null>(null);
  const [fromBalance, setFromBalance] = useState<number | undefined>(undefined);
  const [toBalance, setToBalance] = useState<number | undefined>(undefined);

  function resolveMeta(t: Token): {
    address: `0x${string}` | "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
    decimals: number;
  } | null {
    if (t.symbol.toUpperCase() === "ETH")
      return {
        address: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        decimals: 18,
      };
    const byAddr = (remoteTokens || []).find(
      (rt) => rt.address?.toLowerCase() === (t.address || "").toLowerCase(),
    );
    if (byAddr) return { address: byAddr.address, decimals: byAddr.decimals };
    const bySym = (remoteTokens || []).find(
      (rt) => rt.symbol?.toUpperCase() === t.symbol.toUpperCase(),
    );
    if (bySym) return { address: bySym.address, decimals: bySym.decimals };
    if (t.address && t.decimals != null)
      return { address: t.address as any, decimals: t.decimals };
    return null;
  }

  // Translate technical errors into user-friendly messages
  const formatErrorMessage = (error: any): string => {
    const msg = error?.shortMessage || error?.message || String(error);

    // Common error patterns
    if (msg.includes("insufficient funds") || msg.includes("insufficient balance")) {
      return "Insufficient balance. You don't have enough tokens to complete this swap.";
    }
    if (msg.includes("User rejected") || msg.includes("user rejected")) {
      return "Transaction rejected. You cancelled the transaction in your wallet.";
    }
    if (msg.includes("allowance") || msg.includes("transfer amount exceeds allowance")) {
      return "Approval required. Please approve the token spending first.";
    }
    if (msg.includes("INSUFFICIENT_OUTPUT_AMOUNT") || msg.includes("slippage")) {
      return "Price moved too much. Try increasing your slippage tolerance or refreshing the quote.";
    }
    if (msg.includes("INSUFFICIENT_LIQUIDITY") || msg.includes("insufficient liquidity")) {
      return "Not enough liquidity. This trading pair doesn't have sufficient liquidity for this trade size.";
    }
    if (msg.includes("EXPIRED") || msg.includes("deadline")) {
      return "Transaction expired. The transaction took too long to process. Please try again.";
    }
    if (msg.includes("cannot estimate gas") || msg.includes("gas required exceeds")) {
      return "Transaction will likely fail. Please check your token balances and approvals.";
    }
    if (msg.includes("nonce too low")) {
      return "Transaction conflict. Please wait for pending transactions to complete.";
    }
    if (msg.includes("network") || msg.includes("fetch failed")) {
      return "Network error. Please check your internet connection and try again.";
    }

    // If no pattern matches, return a cleaned version
    return msg.length > 150 ? msg.substring(0, 150) + "..." : msg;
  };

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
        const q = await getBestAggregatedQuote(
          publicClient,
          { address: inMeta.address, decimals: inMeta.decimals },
          { address: outMeta.address, decimals: outMeta.decimals },
          amountWei,
          gasPrice,
        );
        if (cancel) return;
        setQuoteOut({
          wei: q.outAmountWei,
          formatted: fromWei(q.outAmountWei, outMeta.decimals),
          venue: q.venue,
          feeWei: q.feeTakenWei,
          priceImpact: q.priceImpact,
        });
      } catch (e: any) {
        if (!cancel) {
          const friendlyError = formatErrorMessage(e);
          setQuoteError(friendlyError);
        }
      } finally {
        if (!cancel) setQuoting(false);
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [canSwap, fromAmount, fromToken, toToken, remoteTokens, publicClient]);

  // Reflect quoted output into the receive input
  useEffect(() => {
    if (quoteOut) setToAmount(quoteOut.formatted);
    else setToAmount("");
  }, [quoteOut]);

  // Listen for global slippage updates from dialog
  useEffect(() => {
    const handler = () => {
      const v =
        typeof window !== "undefined"
          ? Number(localStorage.getItem("slippagePct") || "0.5")
          : 0.5;
      if (Number.isFinite(v)) setSlippage(v);
    };
    document.addEventListener("sb:slippage-updated", handler as any);
    return () =>
      document.removeEventListener("sb:slippage-updated", handler as any);
  }, []);

  // Fetch balances for selected tokens
  useEffect(() => {
    let cancel = false;
    async function getBalanceForToken(t: Token): Promise<number | undefined> {
      if (!publicClient || !address) return undefined;
      if (t.symbol.toUpperCase() === "ETH") {
        const bal = await publicClient.getBalance({ address });
        return Number(formatUnits(bal, 18));
      }
      const meta = resolveMeta(t);
      if (!meta?.address) return undefined;
      const bal = (await publicClient.readContract({
        address: meta.address as any,
        abi: ERC20_ABI,
        functionName: "balanceOf",
        args: [address],
      })) as bigint;
      return Number(formatUnits(bal, meta.decimals ?? 18));
    }
    async function run() {
      setFromBalance(undefined);
      setToBalance(undefined);
      if (!isConnected || !address) return;
      try {
        const [fb, tb] = await Promise.all([
          getBalanceForToken(fromToken),
          getBalanceForToken(toToken),
        ]);
        if (cancel) return;
        setFromBalance(fb);
        setToBalance(tb);
      } catch {
        if (!cancel) {
          setFromBalance(undefined);
          setToBalance(undefined);
        }
      }
    }
    run();
    return () => {
      cancel = true;
    };
  }, [isConnected, address, fromToken, toToken, publicClient, remoteTokens]);

  const handleFlip = () => {
    setFromToken(toToken);
    setToToken(fromToken);
    setFromAmount(toAmount);
    setToAmount(fromAmount);
  };

  // Get price impact styling and warning level
  const getPriceImpactInfo = (impact: number | undefined) => {
    if (!impact || impact < 0.01) return { color: "text-foreground", level: "none" };
    if (impact < 1) return { color: "text-green-400", level: "low" };
    if (impact < 5) return { color: "text-yellow-400", level: "medium" };
    if (impact < 10) return { color: "text-orange-400", level: "high" };
    return { color: "text-red-400", level: "critical" };
  };

  const priceImpactInfo = getPriceImpactInfo(quoteOut?.priceImpact);

  async function handleSwap() {
    if (!isConnected || !address || !publicClient) return connectPreferred();
    const inMeta = resolveMeta(fromToken);
    const outMeta = resolveMeta(toToken);
    if (!inMeta || !outMeta) return;
    try {
      setQuoteError(null);
      setSwapStatus("checking");
      const amountWei = toWei(fromAmount, inMeta.decimals);
      if (amountWei <= 0n || !quoteOut?.wei) return;

      let txHash: string;

      // Route based on venue
      if (quoteOut.venue === "silverback-v2") {
        setSwapStatus("swapping");
        // Direct V2 swap (testnet-friendly, no OpenOcean dependency)
        toast({
          title: "Swapping via Silverback V2",
          description: "Confirm the transaction in your wallet...",
        });

        const result = await executeSwapViaSilverbackV2(
          publicClient,
          writeContractAsync,
          address,
          { address: inMeta.address, decimals: inMeta.decimals },
          { address: outMeta.address, decimals: outMeta.decimals },
          amountWei,
          quoteOut.wei,
          Math.round(slippage * 100),
        );
        txHash = result.txHash;
      } else {
        // OpenOcean aggregated swap
        const router = unifiedRouterAddress();
        if (!router) {
          setQuoteError("Set VITE_SB_UNIFIED_ROUTER env to the deployed router address");
          setSwapStatus("idle");
          return;
        }

        setSwapStatus("swapping");
        toast({
          title: "Swapping via OpenOcean",
          description: "Confirm the transaction in your wallet...",
        });

        const result = await executeSwapViaOpenOcean(
          publicClient,
          writeContractAsync,
          address,
          router,
          { address: inMeta.address, decimals: inMeta.decimals },
          { address: outMeta.address, decimals: outMeta.decimals },
          amountWei,
          quoteOut.wei,
          Math.round(slippage * 100),
        );
        txHash = result.txHash;
      }

      // Show pending toast
      setSwapStatus("waiting");
      const explorerUrl = `https://sepolia.basescan.org/tx/${txHash}`;
      toast({
        title: "Transaction Submitted",
        description: (
          <div className="flex flex-col gap-1">
            <span>Waiting for confirmation...</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
              View on Basescan
            </a>
          </div>
        ),
      });

      // Wait for confirmation
      await publicClient.waitForTransactionReceipt({ hash: txHash as `0x${string}` });

      // Show success toast
      toast({
        title: "Swap Successful!",
        description: (
          <div className="flex flex-col gap-1">
            <span>Your swap completed successfully</span>
            <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
              View on Basescan
            </a>
          </div>
        ),
      });

      // Clear inputs
      setFromAmount("");
      setToAmount("");
      setSwapStatus("idle");
    } catch (e: any) {
      const errorMsg = formatErrorMessage(e);
      console.error("Swap error:", e);
      setQuoteError(errorMsg);
      setSwapStatus("idle");
      toast({
        title: "Swap Failed",
        description: errorMsg,
        variant: "destructive",
      });
    }
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-10">
        <div className="mx-auto grid max-w-5xl grid-cols-1 gap-6 md:grid-cols-5">
          <section className="order-1 md:order-1 md:col-span-3">
            <div className="rounded-2xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/30 backdrop-blur">
              <div className="mb-4 flex items-center justify-between">
                <h1 className="text-xl font-semibold">Swap</h1>
                <button
                  type="button"
                  className="text-xs text-sky-400 hover:underline"
                  onClick={() =>
                    document.dispatchEvent(new Event("sb:open-slippage"))
                  }
                >
                  Slippage {slippage}%
                </button>
              </div>
              <div className="space-y-3">
                <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
                  <span>Select a share of your balance</span>
                  <QuickFill balance={fromBalance} onSelect={setFromAmount} />
                </div>
                <TokenInput
                  label="You pay"
                  token={fromToken}
                  amount={fromAmount}
                  onAmountChange={setFromAmount}
                  onTokenClick={() => setSelecting("from")}
                  balance={fromBalance}
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
                  balance={toBalance}
                  disabled
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
                  <span className="text-muted-foreground">
                    Minimum received
                  </span>
                  <span>
                    {quoteOut
                      ? `${(Number(quoteOut.formatted) * (1 - slippage / 100)).toFixed(6)} ${toToken.symbol}`
                      : "–"}
                  </span>
                </div>
                {quoteOut?.priceImpact !== undefined && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">Price Impact</span>
                    <span className={priceImpactInfo.color}>
                      {quoteOut.priceImpact < 0.01 ? "<0.01%" : `${quoteOut.priceImpact.toFixed(2)}%`}
                    </span>
                  </div>
                )}
                {quoteOut?.venue && (
                  <div className="mt-2 flex items-center justify-between">
                    <span className="text-muted-foreground">Route</span>
                    <span className="flex items-center gap-1.5">
                      {quoteOut.venue === "silverback-v2" ? (
                        <>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-sky-500/20 text-sky-400 font-medium">
                            Silverback V2
                          </span>
                        </>
                      ) : (
                        <>
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400 font-medium">
                            OpenOcean
                          </span>
                        </>
                      )}
                    </span>
                  </div>
                )}
                {quoteError && (
                  <div className="mt-2 text-xs text-red-400 break-words">
                    {quoteError}
                  </div>
                )}
              </div>

              {/* Price Impact Warning Banner */}
              {priceImpactInfo.level === "high" && (
                <div className="mt-3 rounded-xl border border-orange-400/40 bg-orange-400/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-orange-400 text-lg">⚠</span>
                    <div>
                      <div className="font-semibold text-orange-400">High Price Impact</div>
                      <div className="text-xs text-orange-300/80 mt-1">
                        This trade will move the market price significantly. Consider splitting into smaller trades.
                      </div>
                    </div>
                  </div>
                </div>
              )}
              {priceImpactInfo.level === "critical" && (
                <div className="mt-3 rounded-xl border border-red-400/40 bg-red-400/10 p-3 text-sm">
                  <div className="flex items-start gap-2">
                    <span className="text-red-400 text-lg">🚨</span>
                    <div>
                      <div className="font-semibold text-red-400">Critical Price Impact</div>
                      <div className="text-xs text-red-300/80 mt-1">
                        This trade has extremely high price impact (&gt;10%). You may lose a significant portion of your funds. Please review carefully.
                      </div>
                    </div>
                  </div>
                </div>
              )}

              <Button
                className="mt-4 h-12 w-full bg-brand text-white hover:bg-brand/90"
                disabled={cta.disabled}
                onClick={() => {
                  if (!isConnected) connectPreferred();
                  else handleSwap();
                }}
              >
                {cta.label}
              </Button>
            </div>
          </section>

          <aside className="order-2 md:order-2 md:col-span-2">
            <div className="rounded-2xl border border-border/60 bg-card/40 p-5 backdrop-blur">
              <TrendingPills symbols={["ETH", "KTA", "AERO", "SBCK"]} />
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
