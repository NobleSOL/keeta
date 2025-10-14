import { http, createConfig } from "wagmi";
import { base, mainnet } from "viem/chains";
import { injected, coinbaseWallet, walletConnect } from "wagmi/connectors";

const wcId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID as
  | string
  | undefined;
const baseRpc = (import.meta as any).env?.VITE_BASE_RPC_URL || "https://mainnet.base.org";

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  transports: {
    [base.id]: http(baseRpc),
    [mainnet.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Silverback DEX" }),
    ...(wcId ? [walletConnect({ projectId: wcId })] : []),
  ],
});
