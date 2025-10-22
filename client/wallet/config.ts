import { http, createConfig } from "wagmi";
import { base, baseSepolia, mainnet } from "viem/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

const wcId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;
const baseRpc =
  (import.meta as any).env?.VITE_BASE_RPC_URL || "https://base-sepolia-rpc.publicnode.com";

const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
const appName = "Silverback DEX";
const appDescription =
  "Official Silverback DEX — Trade on Base with deep liquidity and MEV-aware routing. Always verify you are connected to the official Silverback website.";
const appIcon =
  "https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2Fee3a0a5652aa480f9aa42277503e94b2?format=webp&width=256";

// Optional allowlist for WalletConnect origins to avoid Reown Cloud errors on previews
const wcAllowRaw = (import.meta as any).env?.VITE_WC_ALLOWED_ORIGINS as
  | string
  | undefined;
const wcAllowed = (wcAllowRaw || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const isAllowedOrigin =
  wcAllowed.length > 0 && appOrigin && wcAllowed.includes(appOrigin);
const enableWalletConnect = Boolean(wcId && isAllowedOrigin);

// Canonical public URL used in WalletConnect metadata (should be production domain)
const siteUrl =
  ((import.meta as any).env?.VITE_PUBLIC_SITE_URL as string) ||
  "https://www.silverbackdefi.com";

// Coinbase connector allowlist
const cbAllowRaw = (import.meta as any).env?.VITE_CB_ALLOWED_ORIGINS as
  | string
  | undefined;
const cbAllowed = (cbAllowRaw || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
const enableCoinbase =
  cbAllowed.length > 0 && appOrigin && cbAllowed.includes(appOrigin);

export const wagmiConfig = createConfig({
  chains: [baseSepolia, base, mainnet],
  transports: {
    [baseSepolia.id]: http(baseRpc),
    [base.id]: http(),
    [mainnet.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    ...(enableCoinbase
      ? [coinbaseWallet({ appName, appLogoUrl: appIcon })]
      : []),
    ...(enableWalletConnect
      ? [
          walletConnect({
            projectId: wcId!,
            metadata: {
              name: appName,
              description: appDescription,
              url: siteUrl,
              icons: [appIcon],
            },
          }),
        ]
      : []),
  ],
  // Avoid auto reconnecting to connectors that may require COOP/CORS on previews
  autoConnect: false,
});
