import { http, createConfig } from "wagmi";
import { base, baseSepolia, mainnet } from "viem/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

const wcId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;
const baseRpc =
  (import.meta as any).env?.VITE_BASE_RPC_URL || "https://base-rpc.publicnode.com";

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
// Enable WalletConnect if project ID exists and origin is allowed OR on localhost for testing
const isLocalhost = appOrigin.includes("localhost") || appOrigin.includes("127.0.0.1");
const enableWalletConnect = Boolean(wcId && (isAllowedOrigin || isLocalhost));

// Canonical public URL used in WalletConnect metadata (should be production domain)
const siteUrl =
  ((import.meta as any).env?.VITE_PUBLIC_SITE_URL as string) ||
  "https://www.silverbackdefi.app";

// Coinbase connector allowlist
const cbAllowRaw = (import.meta as any).env?.VITE_CB_ALLOWED_ORIGINS as
  | string
  | undefined;
const cbAllowed = (cbAllowRaw || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
// Enable Coinbase Wallet if origin is allowed OR on localhost for testing
const enableCoinbase =
  (cbAllowed.length > 0 && appOrigin && cbAllowed.includes(appOrigin)) || isLocalhost;

export const wagmiConfig = createConfig({
  chains: [base, baseSepolia, mainnet],
  transports: {
    [base.id]: http(baseRpc),
    [baseSepolia.id]: http(),
    [mainnet.id]: http(),
  },
  connectors: [
    injected({
      shimDisconnect: true,
    }),
    ...(enableCoinbase
      ? [coinbaseWallet({
          appName,
          appLogoUrl: appIcon,
          preference: 'smartWalletOnly',
        })]
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
            showQrModal: true,
          }),
        ]
      : []),
  ],
  multiInjectedProviderDiscovery: false,
});
