import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@nomicfoundation/hardhat-verify";

const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";
const BASESCAN_API_KEY = process.env.BASESCAN_API_KEY || process.env.ETHERSCAN_API_KEY || "";

const config: HardhatUserConfig = {
  solidity: {
    compilers: [
      {
        version: "0.8.20",
        settings: { optimizer: { enabled: true, runs: 5000 } },
      },
    ],
  },
  networks: {
    base: {
      url: BASE_RPC_URL,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId: 8453,
    },
  },
  etherscan: {
    apiKey: {
      base: BASESCAN_API_KEY,
    } as any,
    customChains: [
      {
        network: "base",
        chainId: 8453,
        urls: {
          apiURL: "https://api.basescan.org/api",
          browserURL: "https://basescan.org",
        },
      },
      {
        network: "base-sepolia",
        chainId: 84532,
        urls: {
          apiURL: "https://api-sepolia.basescan.org/api",
          browserURL: "https://sepolia.basescan.org",
        },
      },
    ],
  },
};

export default config;
