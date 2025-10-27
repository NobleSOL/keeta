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
import { formatUnits, parseUnits } from "viem";
import { v2Addresses, v2Abi } from "@/amm/v2";
import { v3Address, nfpmAbi } from "@/amm/v3";
import { toast } from "@/hooks/use-toast";
import { base } from "viem/chains";
import { ActivePoolsList } from "@/components/pool/ActivePoolsList";
import type { PoolCardData } from "@/components/pool/ActivePoolCard";

// WETH address on Base (Sepolia and Mainnet use same address)
const WETH_ADDRESS = "0x4200000000000000000000000000000000000006";
const ETH_SENTINEL = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";

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
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "totalSupply",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
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
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  const [lpBalance, setLpBalance] = useState<bigint | null>(null);
  const [lpTotalSupply, setLpTotalSupply] = useState<bigint | null>(null);
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
    if (preferred) connect({ connector: preferred, chainId: base.id });
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
        // Convert ETH sentinel to WETH for pair lookup
        const addrA = tokenA.address.toLowerCase() === ETH_SENTINEL.toLowerCase()
          ? WETH_ADDRESS
          : tokenA.address;
        const addrB = tokenB.address.toLowerCase() === ETH_SENTINEL.toLowerCase()
          ? WETH_ADDRESS
          : tokenB.address;

        // Get pair address
        const pair = (await publicClient.readContract({
          address: addrs.factory,
          abi: v2Abi.factory,
          functionName: "getPair",
          args: [addrA as `0x${string}`, addrB as `0x${string}`],
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
        const isToken0 = token0.toLowerCase() === addrA.toLowerCase();

        if (cancel) return;
        setReserves({
          reserveA: isToken0 ? reserve0 : reserve1,
          reserveB: isToken0 ? reserve1 : reserve0,
        });

        // Get LP token balance and total supply for remove liquidity
        if (address) {
          try {
            const [lpBal, totalSupply] = await Promise.all([
              publicClient.readContract({
                address: pair as `0x${string}`,
                abi: PAIR_ABI,
                functionName: "balanceOf",
                args: [address],
              }) as Promise<bigint>,
              publicClient.readContract({
                address: pair as `0x${string}`,
                abi: PAIR_ABI,
                functionName: "totalSupply",
              }) as Promise<bigint>,
            ]);

            if (!cancel) {
              setLpBalance(lpBal);
              setLpTotalSupply(totalSupply);
            }
          } catch (err) {
            console.log("Error fetching LP balance:", err);
          }
        } else {
          setLpBalance(null);
          setLpTotalSupply(null);
        }
      } catch (error) {
        console.log("Pair doesn't exist or error fetching reserves:", error);
      }
    }
    fetchPairInfo();
    return () => {
      cancel = true;
    };
  }, [tokenA, tokenB, publicClient, version, refetchTrigger, address]);

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

    // Skip auto-calculation if pool is empty (both reserves are 0)
    if (reserves.reserveA === 0n && reserves.reserveB === 0n) return;

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
        const amtAWei = parseUnits(amtA, decA);
        const amtBWei = parseUnits(amtB, decB);

        // Calculate min amounts with slippage
        // For empty pools, use much higher slippage tolerance (5%) to allow any ratio
        const isEmptyPool = !reserves || (reserves.reserveA === 0n && reserves.reserveB === 0n);
        const effectiveSlippage = isEmptyPool ? 5.0 : slippage + 0.1;
        const minA = (amtAWei * BigInt(Math.floor((100 - effectiveSlippage) * 100))) / 10000n;
        const minB = (amtBWei * BigInt(Math.floor((100 - effectiveSlippage) * 100))) / 10000n;
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 min

        console.log("💧 Add Liquidity Debug:", {
          tokenA: tokenA.symbol,
          tokenB: tokenB.symbol,
          amtA,
          amtB,
          amtAWei: amtAWei.toString(),
          amtBWei: amtBWei.toString(),
          minA: minA.toString(),
          minB: minB.toString(),
          effectiveSlippage: `${effectiveSlippage}%`,
          isEmptyPool,
          reserves: reserves ? `${reserves.reserveA.toString()} / ${reserves.reserveB.toString()}` : "none",
        });

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
            // Some tokens (USDT, KTA, etc.) don't allow changing allowance from non-zero to non-zero
            // Reset to 0 first if current allowance is non-zero
            if (allowanceA > 0n) {
              toast({
                title: "Resetting Approval",
                description: `Resetting ${tokenA.symbol} allowance to 0...`,
              });

              const resetHash = await writeContractAsync({
                address: addrA,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [addrs.router, 0n],
              });

              await publicClient.waitForTransactionReceipt({ hash: resetHash as `0x${string}` });
            }

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
            const explorerUrl = `https://basescan.org/tx/${approvalHash}`;
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
            // Some tokens (USDT, KTA, etc.) don't allow changing allowance from non-zero to non-zero
            // Reset to 0 first if current allowance is non-zero
            if (allowanceB > 0n) {
              toast({
                title: "Resetting Approval",
                description: `Resetting ${tokenB.symbol} allowance to 0...`,
              });

              const resetHash = await writeContractAsync({
                address: addrB,
                abi: ERC20_ABI,
                functionName: "approve",
                args: [addrs.router, 0n],
              });

              await publicClient.waitForTransactionReceipt({ hash: resetHash as `0x${string}` });
            }

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
            const explorerUrl = `https://basescan.org/tx/${approvalHash}`;
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

          console.log("🔄 addLiquidityETH params:", {
            token: otherAddr,
            tokenAmount: tokenAmount.toString(),
            tokenMin: tokenMin.toString(),
            ethMin: ethMin.toString(),
            ethValue: ethAmount.toString(),
          });

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

        const explorerUrl = `https://basescan.org/tx/${liquidityHash}`;
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

        // Refetch reserves after successful liquidity add
        setRefetchTrigger((prev) => prev + 1);

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

  const handleRemoveLiquidity = async () => {
    if (version === "v2") {
      const addrs = v2Addresses();
      if (!addrs || !publicClient || !address) {
        toast({
          title: "Configuration Error",
          description: "Missing configuration or wallet not connected",
          variant: "destructive",
        });
        return;
      }

      if (!pairAddress || !lpBalance || lpBalance === 0n) {
        toast({
          title: "No Position",
          description: "You don't have any LP tokens for this pool",
          variant: "destructive",
        });
        return;
      }

      // Use amtA as the percentage or LP token amount to remove
      const lpToRemove = amtA ? parseUnits(amtA, 18) : 0n;
      if (lpToRemove === 0n || lpToRemove > lpBalance) {
        toast({
          title: "Invalid Amount",
          description: "Please enter a valid LP token amount to remove",
          variant: "destructive",
        });
        return;
      }

      try {
        setIsWriting(true);

        // Calculate minimum amounts with slippage
        const slippageMultiplier = 1 - slippage / 100;

        // Calculate expected token amounts based on LP share
        const shareOfPool = Number(lpToRemove) / Number(lpTotalSupply || 1n);
        const expectedA = BigInt(Math.floor(Number(reserves?.reserveA || 0n) * shareOfPool));
        const expectedB = BigInt(Math.floor(Number(reserves?.reserveB || 0n) * shareOfPool));

        const minA = BigInt(Math.floor(Number(expectedA) * slippageMultiplier));
        const minB = BigInt(Math.floor(Number(expectedB) * slippageMultiplier));

        // Deadline: 20 minutes from now
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);

        // Approve LP tokens to router
        toast({
          title: "Approval Required",
          description: "Approving LP tokens...",
        });

        const approvalHash = await writeContractAsync({
          address: pairAddress as `0x${string}`,
          abi: PAIR_ABI,
          functionName: "approve",
          args: [addrs.router, lpToRemove],
        });

        await publicClient.waitForTransactionReceipt({ hash: approvalHash as `0x${string}` });

        // Remove liquidity
        toast({
          title: "Removing Liquidity",
          description: "Confirm the transaction in your wallet...",
        });

        const isEthA = tokenA.symbol.toUpperCase() === "ETH";
        const isEthB = tokenB.symbol.toUpperCase() === "ETH";

        let removeHash: string;

        if (isEthA || isEthB) {
          // One token is ETH - use removeLiquidityETH
          const otherToken = isEthA ? tokenB : tokenA;
          const otherAddr = isEthA
            ? (tokenB.address === ETH_SENTINEL ? WETH_ADDRESS : tokenB.address)
            : (tokenA.address === ETH_SENTINEL ? WETH_ADDRESS : tokenA.address);
          const minToken = isEthA ? minB : minA;
          const minETH = isEthA ? minA : minB;

          removeHash = await writeContractAsync({
            address: addrs.router,
            abi: v2Abi.router,
            functionName: "removeLiquidityETH",
            args: [otherAddr as `0x${string}`, lpToRemove, minToken, minETH, address, deadline],
          });
        } else {
          // Both tokens are ERC20 - use removeLiquidity
          const addrA = tokenA.address === ETH_SENTINEL ? WETH_ADDRESS : tokenA.address;
          const addrB = tokenB.address === ETH_SENTINEL ? WETH_ADDRESS : tokenB.address;

          removeHash = await writeContractAsync({
            address: addrs.router,
            abi: v2Abi.router,
            functionName: "removeLiquidity",
            args: [addrA as `0x${string}`, addrB as `0x${string}`, lpToRemove, minA, minB, address, deadline],
          });
        }

        const explorerUrl = `https://basescan.org/tx/${removeHash}`;
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

        await publicClient.waitForTransactionReceipt({ hash: removeHash as `0x${string}` });

        // Refetch after successful removal
        setRefetchTrigger((prev) => prev + 1);

        toast({
          title: "Success!",
          description: (
            <div className="flex flex-col gap-1">
              <span>Liquidity removed successfully!</span>
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
      } finally {
        setIsWriting(false);
      }
    } else {
      toast({
        title: "Not Implemented",
        description: "V3 remove liquidity not yet implemented",
        variant: "destructive",
      });
    }
  };

  const handleManagePool = (pool: PoolCardData) => {
    // Populate the liquidity input card with the selected pool's tokens
    setTokenA({
      symbol: pool.tokenA.symbol,
      address: pool.tokenA.address as `0x${string}`,
      decimals: pool.tokenA.decimals,
    });
    setTokenB({
      symbol: pool.tokenB.symbol,
      address: pool.tokenB.address as `0x${string}`,
      decimals: pool.tokenB.decimals,
    });
    // If user has a position, default to remove mode, otherwise add mode
    setMode(pool.userLpBalance && pool.userLpBalance > 0n ? "remove" : "add");
    setVersion("v2"); // Ensure we're on V2 when selecting from pool cards
    // Scroll to the top to show the liquidity input card
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-[radial-gradient(100%_60%_at_0%_0%,rgba(255,255,255,0.06)_0%,rgba(255,255,255,0)_60%),radial-gradient(80%_50%_at_100%_100%,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0)_50%)]">
      <div className="container py-10">
        <div className="mb-6 text-center">
          <h1 className="text-3xl font-bold mb-2">Liquidity Pools</h1>
          <p className="text-muted-foreground text-sm">
            Add liquidity to earn 0.3% trading fees on every swap
          </p>
        </div>

        <div className="mx-auto max-w-3xl rounded-2xl border border-border/60 bg-card/60 p-6 shadow-2xl shadow-black/30 backdrop-blur">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg bg-secondary/60 p-1 text-xs border border-border/40">
                <button
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    version === "v2"
                      ? "bg-brand text-white shadow-sm"
                      : "hover:bg-secondary/80"
                  }`}
                  onClick={() => setVersion("v2")}
                >
                  V2
                </button>
                <button
                  className={`px-3 py-1.5 rounded-md transition-all ${
                    version === "v3"
                      ? "bg-brand text-white shadow-sm"
                      : "hover:bg-secondary/80"
                  }`}
                  onClick={() => setVersion("v3")}
                >
                  V3
                </button>
              </div>
              <button
                onClick={() => setMode("add")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  mode === "add"
                    ? "bg-brand text-white shadow-sm"
                    : "bg-secondary/60 hover:bg-secondary/80"
                }`}
              >
                Add Liquidity
              </button>
              <button
                onClick={() => setMode("remove")}
                className={`rounded-full px-4 py-2 text-sm font-medium transition-all ${
                  mode === "remove"
                    ? "bg-brand text-white shadow-sm"
                    : "bg-secondary/60 hover:bg-secondary/80"
                }`}
              >
                Manage Positions
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
                className="rounded-lg bg-secondary/60 border border-border/40 px-3 py-1.5 text-xs font-medium hover:bg-secondary/80 transition-all"
                onClick={handleCreatePool}
              >
                {version === "v2" ? "Create V2 Pair" : "Create V3 Pool"}
              </button>
              <button
                type="button"
                className="text-xs text-sky-400 hover:text-sky-300 transition-colors font-medium"
                onClick={() =>
                  document.dispatchEvent(new Event("sb:open-slippage"))
                }
              >
                Slippage {slippage}%
              </button>
            </div>
          </div>

          <div className="space-y-3">
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
            className="mt-4 h-12 w-full bg-brand text-white hover:bg-brand/90 disabled:opacity-50"
            disabled={cta.disabled || isWriting}
            onClick={() => {
              if (!isConnected) return connectPreferred();
              if (mode === "add") handleAddLiquidity();
              else handleRemoveLiquidity();
            }}
          >
            {isWriting ? (
              <div className="flex items-center gap-2">
                <div className="h-4 w-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                <span>Processing...</span>
              </div>
            ) : (
              cta.label
            )}
          </Button>

          {!isConnected && (
            <p className="mt-3 text-xs text-center text-muted-foreground">
              Connect your wallet to add liquidity to pools
            </p>
          )}

          {isConnected && !pairAddress && mode === "add" && (
            <p className="mt-3 text-xs text-center text-muted-foreground">
              This pool doesn't exist yet. Click "Create V2 Pair" to create it.
            </p>
          )}

          {isConnected && mode === "remove" && lpBalance && lpBalance > 0n && (
            <p className="mt-3 text-xs text-center text-muted-foreground">
              Your LP Balance: {Number(formatUnits(lpBalance, 18)).toFixed(6)} LP tokens
            </p>
          )}

          {isConnected && mode === "remove" && (!lpBalance || lpBalance === 0n) && pairAddress && (
            <p className="mt-3 text-xs text-center text-muted-foreground text-amber-400">
              You don't have any LP tokens for this pool
            </p>
          )}
        </div>

        {/* Active Pools Section - Only show for V2 */}
        {version === "v2" && (
          <div className="mt-10">
            <ActivePoolsList onManage={handleManagePool} />
          </div>
        )}
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
