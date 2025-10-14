import { http, createConfig } from "wagmi";
import { base, mainnet } from "viem/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

const wcId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;
const baseRpc =
  (import.meta as any).env?.VITE_BASE_RPC_URL || "https://mainnet.base.org";

const appUrl = typeof window !== "undefined" ? window.location.origin : "";
const appName = "Silverback DEX";
const appDescription = "Trade on Base with Silverback — deep liquidity and MEV-aware routing.";
const appIcon =
  "https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2Fee3a0a5652aa480f9aa42277503e94b2?format=webp&width=256";

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  transports: {
    [base.id]: http(baseRpc),
    [mainnet.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName, appLogoUrl: appIcon }),
    ...(wcId
      ? [
          walletConnect({
            projectId: wcId,
            metadata: {
              name: appName,
              description: appDescription,
              url: appUrl || "https://silverback.dex",
              icons: [appIcon],
            },
          }),
        ]
      : []),
  ],
});
