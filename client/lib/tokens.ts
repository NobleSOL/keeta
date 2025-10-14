export type TokenMeta = {
  symbol: string;
  name: string;
  logo?: string;
};

// Public, cacheable logos. Fallback handled in TokenLogo component.
export const TOKEN_META: Record<string, TokenMeta> = {
  ETH: {
    symbol: "ETH",
    name: "Ether",
    logo:
      "https://assets.coingecko.com/coins/images/279/standard/ethereum.png",
  },
  USDC: {
    symbol: "USDC",
    name: "USD Coin",
    logo:
      "https://assets.coingecko.com/coins/images/6319/standard/USD_Coin_icon.png",
  },
  WBTC: {
    symbol: "WBTC",
    name: "Wrapped BTC",
    logo:
      "https://assets.coingecko.com/coins/images/7598/standard/wrapped_bitcoin_wbtc.png",
  },
  AERO: {
    symbol: "AERO",
    name: "Aerodrome",
    logo:
      "https://assets.coingecko.com/coins/images/31955/standard/aero.png",
  },
  DEGEN: {
    symbol: "DEGEN",
    name: "Degen",
    logo:
      "https://assets.coingecko.com/coins/images/36110/standard/degen.png",
  },
  SBCK: {
    symbol: "SBCK",
    name: "Silverback",
    logo:
      "https://cdn.builder.io/api/v1/image/assets%2Fd70091a6f5494e0195b033a72f7e79ae%2Fee3a0a5652aa480f9aa42277503e94b2?format=webp&width=64",
  },
  KTA: {
    symbol: "KTA",
    name: "Keeta",
    logo: undefined,
  },
};

export function tokenBySymbol(symbol: string): TokenMeta {
  const key = symbol.toUpperCase();
  return TOKEN_META[key] ?? { symbol: key, name: key };
}
