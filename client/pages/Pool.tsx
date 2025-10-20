import React, { useEffect, useMemo, useState } from "react";
import TokenInput, { Token } from "@/components/swap/TokenInput";
import TokenSelector from "@/components/swap/TokenSelector";
import { Button } from "@/components/ui/button";
import { ArrowDownUp } from "lucide-react";
import { tokenBySymbol } from "@/lib/tokens";
import {
  useAccount,
  useConnect,
  usePublicClient,
  useWriteContract,
} from "wagmi";
import { ERC20_ABI } from "@/lib/erc20";
import { formatUnits } from "viem";
import { v2Addresses, v2Abi } from "@/amm/v2";
import { v3Address, nfpmAbi } from "@/amm/v3";
import { toast } from "@/hooks/use-toast";
import { baseSepolia } from "viem/chains";

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
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "token1",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export default function Pool() {
  const [mode, setMode] = useState<"add" | "remove">("add");
  const [version, setVersion] = useState<"v2" | "v3">("v2");
  const [feeTier, setFeeTier] = useState<number>(3000);
  const [tokenA, setTokenA] = useState<Token>({ ...tokenBySymbol("ETH") });
  const [tokenB, setTokenB] = useState<Token>({ ...tokenBySymbol("USDC") });
  const [amtA, setAmtA] = useState("");
  const [amtB, setAmtB] = useState("");
  const [selecting, setSelecting] = useState<null | "A" | "B">(null);
  const [pairAddress, setPairAddress] = useState<string | null>(null);
  const [reserves, setReserves] = useState<{ reserveA: bigint; reserveB: bigint } | null>(null);
  const [lastEditedField, setLastEditedField] = useState<"A" | "B">("A");
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

  const { address, isConnected } = useAccount();
  const { connectors, connect } = useConnect();
  const publicClient = usePublicClient();
  const { writeContractAsync, isPending: isWriting } = useWriteContract();
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

  // Fetch pair address and reserves
  useEffect(() => {
    let cancel = false;
    async function fetchPairInfo() {
      setPairAddress(null);
      setReserves(null);
      if (!publicClient || version !== "v2") return;
      const addrs = v2Addresses();
      if (!addrs || !tokenA.address || !tokenB.address) return;

      try {
        // Get pair address
        const pair = (await publicClient.readContract({
          address: addrs.factory,
          abi: v2Abi.factory,
          functionName: "getPair",
          args: [tokenA.address as `0x${string}`, tokenB.address as `0x${string}`],
        })) as string;

        if (cancel || !pair || pair === "0x0000000000000000000000000000000000000000") {
          return; // Pair doesn't exist yet
        }

        setPairAddress(pair);

        // Get reserves
        const [reserve0, reserve1] = (await publicClient.readContract({
          address: pair as `0x${string}`,
          abi: PAIR_ABI,
          functionName: "getReserves",
        })) as [bigint, bigint, number];

        // Get token0 to determine order
        const token0 = (await publicClient.readContract({
          address: pair as `0x${string}`,
          abi: PAIR_ABI,
          functionName: "token0",
        })) as string;

        // Determine if tokenA is token0 or token1
        const isToken0 = token0.toLowerCase() === (tokenA.address as string).toLowerCase();

        if (cancel) return;
        setReserves({
          reserveA: isToken0 ? reserve0 : reserve1,
          reserveB: isToken0 ? reserve1 : reserve0,
        });
      } catch (error) {
        console.log("Pair doesn't exist or error fetching reserves:", error);
      }
    }
    fetchPairInfo();
    return () => {
      cancel = true;
    };
  }, [tokenA, tokenB, publicClient, version]);

  // Fetch balances
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

  // Auto-calculate amounts based on pool ratio
  useEffect(() => {
    if (!reserves || mode !== "add") return;

    const decA = tokenA.decimals ?? 18;
    const decB = tokenB.decimals ?? 18;

    if (lastEditedField === "A" && amtA) {
      // Calculate amtB from amtA
      const amtAWei = BigInt(Math.floor(Number(amtA) * 10 ** decA));
      const amtBWei = (amtAWei * reserves.reserveB) / reserves.reserveA;
      const amtBFormatted = Number(formatUnits(amtBWei, decB));
      setAmtB(amtBFormatted.toFixed(6));
    } else if (lastEditedField === "B" && amtB) {
      // Calculate amtA from amtB
      const amtBWei = BigInt(Math.floor(Number(amtB) * 10 ** decB));
      const amtAWei = (amtBWei * reserves.reserveA) / reserves.reserveB;
      const amtAFormatted = Number(formatUnits(amtAWei, decA));
      setAmtA(amtAFormatted.toFixed(6));
    }
  }, [amtA, amtB, reserves, lastEditedField, mode, tokenA.decimals, tokenB.decimals]);

  const handleCreatePool = async () => {
    if (!isConnected) return connectPreferred();
    if (version === "v2") {
      const addrs = v2Addresses();
      if (!addrs)
        return alert("Set VITE_SB_V2_FACTORY and VITE_SB_V2_ROUTER envs");
      await writeContractAsync({
        address: addrs.factory,
        abi: v2Abi.factory,
        functionName: "createPair",
        args: [tokenA.address as any, tokenB.address as any],
      });
    } else {
      const nfpm = v3Address();
      if (!nfpm) return alert("Set VITE_V3_NFPM env");
      const SQRT_PRICE_1_1 = BigInt("79228162514264337593543950336");
      await writeContractAsync({
        address: nfpm,
        abi: nfpmAbi,
        functionName: "createAndInitializePoolIfNecessary",
        args: [
          tokenA.address as any,
          tokenB.address as any,
          feeTier as any,
          SQRT_PRICE_1_1,
        ],
        value: 0n,
      });
    }
  };

  const handleFlip = () => {
    setTokenA(tokenB);
    setTokenB(tokenA);
    setAmtA(amtB);
    setAmtB(amtA);
  };

  const handleAddLiquidity = async () => {
    if (!isConnected || !address || !publicClient) return connectPreferred();
    if (version === "v2") {
      const addrs = v2Addresses();
      if (!addrs) {
        toast({
          title: "Configuration Error",
          description: "Set VITE_SB_V2_FACTORY and VITE_SB_V2_ROUTER envs",
          variant: "destructive",
        });
        return;
      }

      try {
        const decA = tokenA.decimals ?? 18;
        const decB = tokenB.decimals ?? 18;
        const amtAWei = BigInt(Math.floor(Number(amtA) * 10 ** decA));
        const amtBWei = BigInt(Math.floor(Number(amtB) * 10 ** decB));

        // Calculate min amounts with slippage
        const minA = (amtAWei * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;
        const minB = (amtBWei * BigInt(Math.floor((100 - slippage) * 100))) / 10000n;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

        // Approve tokens first if needed
        const addrA = tokenA.address as `0x${string}`;
        const addrB = tokenB.address as `0x${string}`;

        // Check and approve tokenA
        if (tokenA.symbol.toUpperCase() !== "ETH") {
          const allowanceA = (await publicClient.readContract({
            address: addrA,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, addrs.router],
          })) as bigint;

          if (allowanceA < amtAWei) {
            toast({
              title: "Approval Required",
              description: `Approving ${tokenA.symbol}...`,
            });

            const approvalHash = await writeContractAsync({
              address: addrA,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [addrs.router, amtAWei],
            });

            // Wait for approval confirmation
            const explorerUrl = `https://sepolia.basescan.org/tx/${approvalHash}`;
            toast({
              title: "Waiting for Approval",
              description: (
                <div className="flex flex-col gap-1">
                  <span>Confirming {tokenA.symbol} approval...</span>
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
                    View on Basescan
                  </a>
                </div>
              ),
            });

            await publicClient.waitForTransactionReceipt({ hash: approvalHash as `0x${string}` });

            toast({
              title: "Approval Confirmed",
              description: `${tokenA.symbol} approved successfully`,
            });
          }
        }

        // Check and approve tokenB
        if (tokenB.symbol.toUpperCase() !== "ETH") {
          const allowanceB = (await publicClient.readContract({
            address: addrB,
            abi: ERC20_ABI,
            functionName: "allowance",
            args: [address, addrs.router],
          })) as bigint;

          if (allowanceB < amtBWei) {
            toast({
              title: "Approval Required",
              description: `Approving ${tokenB.symbol}...`,
            });

            const approvalHash = await writeContractAsync({
              address: addrB,
              abi: ERC20_ABI,
              functionName: "approve",
              args: [addrs.router, amtBWei],
            });

            // Wait for approval confirmation
            const explorerUrl = `https://sepolia.basescan.org/tx/${approvalHash}`;
            toast({
              title: "Waiting for Approval",
              description: (
                <div className="flex flex-col gap-1">
                  <span>Confirming {tokenB.symbol} approval...</span>
                  <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
                    View on Basescan
                  </a>
                </div>
              ),
            });

            await publicClient.waitForTransactionReceipt({ hash: approvalHash as `0x${string}` });

            toast({
              title: "Approval Confirmed",
              description: `${tokenB.symbol} approved successfully`,
            });
          }
        }

        // Add liquidity
        toast({
          title: "Adding Liquidity",
          description: "Confirm the transaction in your wallet...",
        });

        const isEthA = tokenA.symbol.toUpperCase() === "ETH";
        const isEthB = tokenB.symbol.toUpperCase() === "ETH";

        let liquidityHash: string;

        if (isEthA || isEthB) {
          // One token is ETH - use addLiquidityETH
          const ethToken = isEthA ? tokenA : tokenB;
          const otherToken = isEthA ? tokenB : tokenA;
          const otherAddr = isEthA ? addrB : addrA;
          const ethAmount = isEthA ? amtAWei : amtBWei;
          const tokenAmount = isEthA ? amtBWei : amtAWei;
          const ethMin = isEthA ? minA : minB;
          const tokenMin = isEthA ? minB : minA;

          liquidityHash = await writeContractAsync({
            address: addrs.router,
            abi: v2Abi.router,
            functionName: "addLiquidityETH",
            args: [otherAddr, tokenAmount, tokenMin, ethMin, address, deadline],
            value: ethAmount,
          });
        } else {
          // Both tokens are ERC20 - use addLiquidity
          liquidityHash = await writeContractAsync({
            address: addrs.router,
            abi: v2Abi.router,
            functionName: "addLiquidity",
            args: [addrA, addrB, amtAWei, amtBWei, minA, minB, address, deadline],
          });
        }

        const explorerUrl = `https://sepolia.basescan.org/tx/${liquidityHash}`;
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

        await publicClient.waitForTransactionReceipt({ hash: liquidityHash as `0x${string}` });

        toast({
          title: "Success!",
          description: (
            <div className="flex flex-col gap-1">
              <span>Liquidity added successfully!</span>
              <a href={explorerUrl} target="_blank" rel="noopener noreferrer" className="text-sky-400 underline text-xs">
                View on Basescan
              </a>
            </div>
          ),
        });

        // Clear inputs
        setAmtA("");
        setAmtB("");
      } catch (error: any) {
        toast({
          title: "Transaction Failed",
          description: error?.shortMessage || error?.message || String(error),
          variant: "destructive",
        });
      }
    } else {
      toast({
        title: "Not Implemented",
        description: "V3 add liquidity not yet implemented",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-10">
        <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-md bg-secondary/60 p-1 text-xs">
                <button
                  className={`px-2 py-1 rounded ${version === "v2" ? "bg-brand text-white" : ""}`}
                  onClick={() => setVersion("v2")}
                >
                  V2
                </button>
                <button
                  className={`px-2 py-1 rounded ${version === "v3" ? "bg-brand text-white" : ""}`}
                  onClick={() => setVersion("v3")}
                >
                  V3
                </button>
              </div>
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
              {version === "v3" && (
                <div className="ml-2 flex items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Fee tier</span>
                  <input
                    value={feeTier}
                    onChange={(e) =>
                      setFeeTier(Number(e.target.value.replace(/[^0-9]/g, "")))
                    }
                    className="h-7 w-20 rounded-md border border-border/60 bg-secondary/60 px-2 text-right"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-3 sm:self-auto">
              <button
                type="button"
                className="rounded-md bg-secondary/60 px-3 py-1 text-xs"
                onClick={handleCreatePool}
              >
                {version === "v2" ? "Create V2 Pair" : "Create V3 Pool"}
              </button>
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
          </div>

          <div className="space-y-3">
            {reserves && pairAddress && mode === "add" && (
              <div className="mb-2 rounded-md bg-secondary/40 p-2 text-xs text-muted-foreground">
                Pool exists at {pairAddress.slice(0, 6)}...{pairAddress.slice(-4)}
                <br />
                Current ratio: 1 {tokenA.symbol} = {(Number(reserves.reserveB) / Number(reserves.reserveA)).toFixed(4)} {tokenB.symbol}
              </div>
            )}
            <TokenInput
              label={mode === "add" ? "Token A" : "Remove A"}
              token={tokenA}
              amount={amtA}
              onAmountChange={(val) => {
                setAmtA(val);
                setLastEditedField("A");
              }}
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
              onAmountChange={(val) => {
                setAmtB(val);
                setLastEditedField("B");
              }}
              onTokenClick={() => setSelecting("B")}
              balance={balB}
            />
          </div>

          <Button
            className="mt-4 h-12 w-full bg-brand text-white hover:bg-brand/90"
            disabled={cta.disabled || isWriting}
            onClick={() => {
              if (!isConnected) return connectPreferred();
              if (mode === "add") handleAddLiquidity();
              else alert("Remove liquidity not yet implemented");
            }}
          >
            {isWriting ? "Processing..." : cta.label}
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
