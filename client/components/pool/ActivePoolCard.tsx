import { formatUnits } from "viem";
import { TrendingUp, Droplet, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TokenLogo } from "@/components/shared/TokenLogo";

export interface PoolCardData {
  pairAddress: string;
  tokenA: {
    symbol: string;
    address: string;
    decimals: number;
    logo?: string;
  };
  tokenB: {
    symbol: string;
    address: string;
    decimals: number;
    logo?: string;
  };
  reserveA: bigint;
  reserveB: bigint;
  totalSupply: bigint;
  userLpBalance?: bigint;
  userPoolShare?: number;
}

export function ActivePoolCard({ pool, onManage }: { pool: PoolCardData; onManage: (pool: PoolCardData) => void }) {
  const reserveAFormatted = Number(formatUnits(pool.reserveA, pool.tokenA.decimals));
  const reserveBFormatted = Number(formatUnits(pool.reserveB, pool.tokenB.decimals));

  // Calculate TVL (simple display without USD pricing)
  const tvl = `${reserveAFormatted.toFixed(2)} ${pool.tokenA.symbol} + ${reserveBFormatted.toFixed(2)} ${pool.tokenB.symbol}`;

  // Estimate APY (simplified - would need historical volume data for accuracy)
  const estimatedDailyFee = reserveAFormatted * 0.003;
  const estimatedAPY = reserveAFormatted > 0
    ? ((estimatedDailyFee / reserveAFormatted) * 365 * 100).toFixed(2)
    : "0.00";

  // User's position
  const hasPosition = pool.userLpBalance && pool.userLpBalance > 0n;
  const userTokenA = hasPosition && pool.totalSupply > 0n
    ? Number(formatUnits((pool.reserveA * pool.userLpBalance!) / pool.totalSupply, pool.tokenA.decimals))
    : 0;
  const userTokenB = hasPosition && pool.totalSupply > 0n
    ? Number(formatUnits((pool.reserveB * pool.userLpBalance!) / pool.totalSupply, pool.tokenB.decimals))
    : 0;

  return (
    <div className={`rounded-xl border bg-card/40 backdrop-blur p-4 transition-all hover:border-brand/50 hover:shadow-lg ${hasPosition ? 'border-brand/30 bg-brand/5' : 'border-border/60'}`}>
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          {/* Token pair display */}
          <div className="flex items-center">
            <div className="w-8 h-8 rounded-full shadow-md border-2 border-background">
              <TokenLogo src={pool.tokenA.logo} alt={pool.tokenA.symbol} size={32} />
            </div>
            <div className="w-8 h-8 rounded-full shadow-md border-2 border-background -ml-2">
              <TokenLogo src={pool.tokenB.logo} alt={pool.tokenB.symbol} size={32} />
            </div>
          </div>
          <div>
            <div className="font-semibold text-sm">
              {pool.tokenA.symbol}/{pool.tokenB.symbol}
            </div>
            <div className="text-xs text-muted-foreground">
              AMM Pool
            </div>
          </div>
        </div>

        {hasPosition && (
          <div className="rounded-full bg-brand/20 px-2 py-0.5 text-xs font-medium text-brand">
            Your Pool
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 mb-3">
        {/* TVL */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-2">
          <div className="text-xs text-muted-foreground mb-1">Total Liquidity</div>
          <div className="text-xs font-semibold leading-tight">{tvl}</div>
        </div>

        {/* APY */}
        <div className="rounded-lg border border-border/40 bg-secondary/40 p-2">
          <div className="flex items-center gap-1 mb-1">
            <TrendingUp className="h-3 w-3 text-green-400" />
            <span className="text-xs text-muted-foreground">Est. APY</span>
          </div>
          <div className="text-xs font-semibold text-green-400">{estimatedAPY}%</div>
        </div>
      </div>

      {/* User Position */}
      {hasPosition && (
        <div className="rounded-lg border border-brand/40 bg-brand/10 p-2 mb-3">
          <div className="flex items-center gap-1 mb-1">
            <Droplet className="h-3 w-3 text-sky-400" />
            <span className="text-xs text-muted-foreground">Your Position</span>
          </div>
          <div className="text-xs font-semibold text-sky-400">
            {pool.userPoolShare?.toFixed(4)}% of pool
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {userTokenA.toFixed(4)} {pool.tokenA.symbol} + {userTokenB.toFixed(4)} {pool.tokenB.symbol}
          </div>
        </div>
      )}

      {/* Exchange Rate */}
      <div className="text-xs text-muted-foreground mb-3 space-y-0.5">
        <div>1 {pool.tokenA.symbol} = {(reserveBFormatted / reserveAFormatted).toFixed(6)} {pool.tokenB.symbol}</div>
        <div>1 {pool.tokenB.symbol} = {(reserveAFormatted / reserveBFormatted).toFixed(6)} {pool.tokenA.symbol}</div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          className="flex-1 text-xs h-8"
          onClick={() => onManage(pool)}
        >
          {hasPosition ? 'Manage' : 'Add Liquidity'}
          <ArrowRight className="h-3 w-3 ml-1" />
        </Button>
      </div>
    </div>
  );
}
