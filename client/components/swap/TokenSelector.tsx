import { useEffect, useMemo, useState } from "react";
import TokenLogo from "@/components/shared/TokenLogo";
import { Button } from "@/components/ui/button";
import { TOKEN_META, tokenBySymbol } from "@/lib/tokens";
import type { Token } from "./TokenInput";
import { usePublicClient } from "wagmi";
import type { Address } from "viem";
import { ERC20_ABI } from "@/lib/erc20";

function isAddress(v: string): v is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(v);
}

export default function TokenSelector({
  open,
  onClose,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  onSelect: (t: Token) => void;
}) {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [customToken, setCustomToken] = useState<Token | null>(null);
  const publicClient = usePublicClient();

  const knownTokens: Token[] = useMemo(() => {
    return Object.values(TOKEN_META).map((m) => ({ ...m }));
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q || isAddress(q)) return knownTokens;
    return knownTokens.filter(
      (t) =>
        t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q),
    );
  }, [knownTokens, query]);

  useEffect(() => {
    let cancel = false;
    async function fetchCustom() {
      if (!open) return;
      const q = query.trim();
      if (!isAddress(q) || !publicClient) {
        setCustomToken(null);
        return;
      }
      setLoading(true);
      try {
        const [symbol, name, decimals] = await Promise.all([
          publicClient.readContract({
            address: q,
            abi: ERC20_ABI,
            functionName: "symbol",
          }) as Promise<string>,
          publicClient.readContract({
            address: q,
            abi: ERC20_ABI,
            functionName: "name",
          }) as Promise<string>,
          publicClient.readContract({
            address: q,
            abi: ERC20_ABI,
            functionName: "decimals",
          }) as Promise<number>,
        ]);
        if (!cancel) {
          setCustomToken({
            symbol: symbol || "TOKEN",
            name: name || symbol || "Token",
            decimals,
            address: q,
          });
        }
      } catch (e) {
        if (!cancel) setCustomToken(null);
      } finally {
        if (!cancel) setLoading(false);
      }
    }
    fetchCustom();
    return () => {
      cancel = true;
    };
  }, [open, publicClient, query]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="relative z-10 w-full max-w-md rounded-2xl border border-border/60 bg-card p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Select a token</h3>
          <button
            className="text-sm text-muted-foreground hover:text-foreground"
            onClick={onClose}
          >
            Close
          </button>
        </div>
        <input
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search name or paste address (0x...)"
          className="mb-3 w-full rounded-lg border border-border/60 bg-secondary/60 px-3 py-2 outline-none placeholder:text-muted-foreground/60"
        />

        {isAddress(query.trim()) ? (
          <div className="mb-3">
            <div className="mb-2 text-xs text-muted-foreground">
              {loading
                ? "Fetching token..."
                : customToken
                  ? "Custom token"
                  : "No token found"}
            </div>
            {customToken && (
              <button
                onClick={() => {
                  onSelect(customToken);
                  onClose();
                }}
                className="flex w-full items-center justify-between rounded-lg border border-border/60 bg-secondary/40 px-3 py-2 text-left hover:bg-secondary/60"
              >
                <div className="flex items-center gap-2">
                  <TokenLogo alt={`${customToken.name} logo`} size={20} />
                  <div>
                    <div className="font-medium">{customToken.symbol}</div>
                    <div className="text-xs text-muted-foreground">
                      {customToken.name}
                    </div>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground">Add</span>
              </button>
            )}
          </div>
        ) : null}

        <div className="max-h-72 overflow-y-auto rounded-lg border border-border/60">
          {filtered.map((t) => (
            <button
              key={t.symbol}
              onClick={() => {
                onSelect(t);
                onClose();
              }}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-secondary/50"
            >
              <div className="flex items-center gap-2">
                <TokenLogo src={t.logo} alt={`${t.name} logo`} size={20} />
                <div>
                  <div className="font-medium">{t.symbol}</div>
                  <div className="text-xs text-muted-foreground">{t.name}</div>
                </div>
              </div>
              <span className="text-xs text-muted-foreground">Select</span>
            </button>
          ))}
        </div>

        <div className="mt-3 text-xs text-muted-foreground">
          Tip: Paste a token contract address to import a token.
        </div>
      </div>
    </div>
  );
}
