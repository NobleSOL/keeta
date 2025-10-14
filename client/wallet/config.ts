import { http, createConfig } from "wagmi";
import { base, mainnet } from "viem/chains";
import { injected, coinbaseWallet } from "wagmi/connectors";

export const wagmiConfig = createConfig({
  chains: [base, mainnet],
  transports: {
    [base.id]: http(),
    [mainnet.id]: http(),
  },
  connectors: [
    injected({ shimDisconnect: true }),
    coinbaseWallet({ appName: "Silverback DEX" }),
  ],
});
