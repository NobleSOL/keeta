import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type Token = {
  symbol: string;
  name: string;
  logo?: string;
};

export function TokenInput({
  label,
  token,
  amount,
  onAmountChange,
  onTokenClick,
  balance,
  disabled,
}: {
  label: string;
  token: Token;
  amount: string;
  onAmountChange: (v: string) => void;
  onTokenClick: () => void;
  balance?: number;
  disabled?: boolean;
}) {
  const formattedBalance = useMemo(() => {
    if (balance == null) return "";
    if (balance === 0) return "0";
    return balance.toLocaleString(undefined, { maximumFractionDigits: 6 });
  }, [balance]);

  return (
    <div className="rounded-xl border border-border/60 bg-secondary/60 p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
        <span>{label}</span>
        {formattedBalance !== "" && <span>Bal: {formattedBalance}</span>}
      </div>
      <div className="flex items-center gap-3">
        <Button
          type="button"
          onClick={onTokenClick}
          className="min-w-28 justify-between bg-card hover:bg-card/80 px-3"
        >
          <div className="flex items-center gap-2">
            <div className="size-5 rounded-full bg-muted" />
            <span className="font-semibold">{token.symbol}</span>
          </div>
          <ChevronDown className="opacity-70" />
        </Button>
        <input
          inputMode="decimal"
          pattern="^[0-9]*[.,]?[0-9]*$"
          placeholder="0.0"
          value={amount}
          onChange={(e) => onAmountChange(e.target.value.replace(",", "."))}
          disabled={disabled}
          className={cn(
            "ml-auto flex-1 bg-transparent text-right text-3xl font-semibold outline-none placeholder:text-muted-foreground/60",
          )}
        />
      </div>
    </div>
  );
}

export default TokenInput;
