import { useEffect, useRef, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { baseSepolia } from "viem/chains";
import { Wallet, Copy, ExternalLink, Check } from "lucide-react";

function truncate(addr?: string) {
  if (!addr) return "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

// Wallet logos mapping - using reliable CDN URLs
const WALLET_ICONS: Record<string, string> = {
  metamask: "https://upload.wikimedia.org/wikipedia/commons/3/36/MetaMask_Fox.svg",
  coinbase: "https://images.ctfassets.net/q5ulk4bp65x7/3TBS4oVkD1ghowTqVQJlqj/d9e39fc1ad9c25f9adb8aefcdaa1b448/coinbase-icon2.svg",
  walletconnect: "https://seeklogo.com/images/W/walletconnect-logo-EE83B50C97-seeklogo.com.png",
  phantom: "https://phantom.app/img/phantom-logo.svg",
  rainbow: "https://avatars.githubusercontent.com/u/48327834?s=200&v=4",
  trust: "https://trustwallet.com/assets/images/media/assets/TWT.png",
};

export default function ConnectButton() {
  const { address, isConnected, connector } = useAccount();
  const { connectors, connect, status, error } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (open && ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener("click", onDoc);
    return () => document.removeEventListener("click", onDoc);
  }, [open]);

  const handleCopy = async () => {
    if (address) {
      await navigator.clipboard.writeText(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const getWalletIcon = (name: string): string | null => {
    const lowerName = name.toLowerCase();
    for (const [key, icon] of Object.entries(WALLET_ICONS)) {
      if (lowerName.includes(key)) return icon;
    }
    return null;
  };

  // Connected state - show address dropdown
  if (isConnected) {
    return (
      <div className="relative" ref={ref}>
        <Button
          onClick={() => setOpen((o) => !o)}
          className="gap-2"
        >
          {connector && getWalletIcon(connector.name) && (
            <img
              src={getWalletIcon(connector.name)!}
              alt={connector.name}
              className="w-4 h-4 rounded-full"
            />
          )}
          {truncate(address)}
        </Button>
        {open && (
          <div className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-md border border-border/60 bg-popover text-popover-foreground shadow-md">
            <div className="p-3 border-b border-border/60">
              <div className="text-xs text-muted-foreground mb-1">Connected with {connector?.name}</div>
              <div className="font-mono text-sm break-all">{address}</div>
            </div>
            <div className="p-1">
              <button
                className="flex items-center gap-2 w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-4 w-4" />
                    <span>Copy Address</span>
                  </>
                )}
              </button>
              <a
                href={`https://sepolia.basescan.org/address/${address}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent transition-colors"
              >
                <ExternalLink className="h-4 w-4" />
                <span>View on Basescan</span>
              </a>
              <button
                className="flex items-center gap-2 w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent text-destructive transition-colors"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                <Wallet className="h-4 w-4" />
                <span>Disconnect</span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // Not connected - show wallet selection modal
  return (
    <div className="relative" ref={ref}>
      <Button
        onClick={() => setOpen(true)}
        className="gap-2"
      >
        <Wallet className="h-4 w-4" />
        Connect Wallet
      </Button>
      {open && (
        <div className="absolute right-0 z-50 mt-2 w-72 overflow-hidden rounded-md border border-border/60 bg-popover text-popover-foreground shadow-md">
          <div className="p-4 border-b border-border/60">
            <h3 className="font-semibold text-base mb-1">Connect Wallet</h3>
            <p className="text-xs text-muted-foreground">
              Choose your preferred wallet to connect to Silverback
            </p>
          </div>
          <div className="p-2 space-y-1">
            {connectors.map((c) => {
              const icon = getWalletIcon(c.name);
              return (
                <button
                  key={c.id}
                  className={cn(
                    "flex items-center gap-3 w-full rounded-lg px-3 py-3 text-left transition-colors",
                    "hover:bg-secondary/80 border border-transparent hover:border-border/40",
                    {
                      "opacity-50 cursor-not-allowed": !c.ready,
                    },
                  )}
                  disabled={!c.ready}
                  onClick={() => {
                    connect({ connector: c, chainId: baseSepolia.id });
                    setOpen(false);
                    // Save last used wallet
                    if (typeof window !== "undefined") {
                      localStorage.setItem("lastWallet", c.id);
                    }
                  }}
                >
                  {icon ? (
                    <img
                      src={icon}
                      alt={c.name}
                      className="w-8 h-8 rounded-full"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-secondary flex items-center justify-center">
                      <Wallet className="h-4 w-4" />
                    </div>
                  )}
                  <div className="flex-1">
                    <div className="font-medium">{c.name}</div>
                    {!c.ready && (
                      <div className="text-xs text-muted-foreground">Not installed</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
          {status === "error" && error && (
            <div className="p-3 border-t border-border/60 bg-destructive/10">
              <div className="text-xs text-destructive font-medium">
                {error.message}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
