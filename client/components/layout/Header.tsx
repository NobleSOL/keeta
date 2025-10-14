import { Link, NavLink, useLocation } from "react-router-dom";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ChevronDown, Settings2, Wallet2 } from "lucide-react";

const NavItem = ({ to, label }: { to: string; label: string }) => (
  <NavLink
    to={to}
    className={({ isActive }) =>
      cn(
        "px-3 py-2 rounded-md text-sm font-medium transition-colors",
        isActive
          ? "bg-secondary text-secondary-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
      )
    }
  >
    {label}
  </NavLink>
);

export function Header() {
  const location = useLocation();
  const [network, setNetwork] = useState<"Base" | "Keeta">("Base");
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (open && menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, [open]);

  return (
    <header className="sticky top-0 z-50 w-full border-b border-border/60 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container flex h-16 items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-2">
            <img
              src="https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2Fee3a0a5652aa480f9aa42277503e94b2?format=webp&width=64"
              alt="Silverback logo"
              className="h-8 w-8 rounded-md object-contain"
            />
            <span className="text-lg font-extrabold tracking-tight uppercase">
              Silverback
            </span>
          </Link>
          <nav className="hidden md:flex items-center gap-1">
            <NavItem to="/" label="Swap" />
            <NavItem to="/pool" label="Pool" />
            <NavItem to="/portfolio" label="Portfolio" />
          </nav>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative" ref={menuRef}>
            <Button
              variant="secondary"
              className="hidden sm:inline-flex gap-2"
              onClick={() => setOpen((o) => !o)}
              aria-haspopup="menu"
              aria-expanded={open}
            >
              <div
                className={cn(
                  "size-2 rounded-full animate-pulse",
                  network === "Base" ? "bg-sky-400" : "bg-purple-400",
                )}
              />
              <span className="font-semibold">{network}</span>
              <ChevronDown className="opacity-70" />
            </Button>
            {open && (
              <div
                role="menu"
                className="absolute right-0 mt-2 w-36 overflow-hidden rounded-md border border-border/60 bg-popover p-1 text-popover-foreground shadow-md z-50"
              >
                <button
                  className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setNetwork("Base");
                    setOpen(false);
                  }}
                >
                  Base
                </button>
                <button
                  className="block w-full rounded-sm px-3 py-2 text-left text-sm hover:bg-accent"
                  onClick={() => {
                    setNetwork("Keeta");
                    setOpen(false);
                  }}
                >
                  Keeta
                </button>
              </div>
            )}
          </div>
          <Button variant="ghost" size="icon" aria-label="Settings">
            <Settings2 />
          </Button>
          <div>
            {/* Wagmi-based connect */}
            <ConnectButton />
          </div>
        </div>
      </div>
    </header>
  );
}

export default Header;
