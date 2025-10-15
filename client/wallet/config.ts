import { http, createConfig } from "wagmi";
import { base, mainnet } from "viem/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

const wcId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;
const baseRpc =
  (import.meta as any).env?.VITE_BASE_RPC_URL || "https://mainnet.base.org";

const appOrigin = typeof window !== "undefined" ? window.location.origin : "";
const appName = "Silverback DEX";
const appDescription =
  "Trade on Base with Silverback — deep liquidity and MEV-aware routing.";
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
const isAllowedOrigin = wcAllowed.length > 0 && appOrigin && wcAllowed.includes(appOrigin);
const enableWalletConnect = Boolean(wcId && isAllowedOrigin);

// Canonical public URL used in WalletConnect metadata (should be production domain)
const siteUrl =
  ((import.meta as any).env?.VITE_PUBLIC_SITE_URL as string) ||
  "https://silverbackdex.netlify.app";

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  transports: {
    [base.id]: http(baseRpc),
    [mainnet.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName, appLogoUrl: appIcon }),
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
});
