export const SILVERBACK_V2_FACTORY =
  (import.meta as any).env?.VITE_SB_V2_FACTORY || "0xF925941026a46244dFFC236F2A01F1282ecFFa6d";
export const SILVERBACK_V2_ROUTER =
  (import.meta as any).env?.VITE_SB_V2_ROUTER || "0x46CC63663a5f7bD17c664BfFe35546f13B788303";

// If using Uniswap V3-like periphery until Silverback V3 is deployed
export const V3_POSITION_MANAGER = (import.meta as any).env?.VITE_V3_NFPM || ""; // NonfungiblePositionManager
export const V3_FACTORY = (import.meta as any).env?.VITE_V3_FACTORY || "";

export function isAddress(v?: string): v is `0x${string}` {
  return !!v && /^0x[a-fA-F0-9]{40}$/.test(v);
}

/**
 * Get API base URL based on current network
 * - Base: Uses current origin (vite dev server on 8080 or deployed URL)
 * - Keeta: Uses localhost:8888 (Keeta backend server)
 */
export function getApiBaseUrl(network: "base" | "keeta"): string {
  if (network === "keeta") {
    return "http://localhost:8888";
  }
  // For Base, use current origin (works in dev and production)
  return typeof window !== "undefined" ? window.location.origin : "";
}

/**
 * Helper to make network-aware API calls
 */
export async function fetchApi(
  endpoint: string,
  network: "base" | "keeta",
  options?: RequestInit
): Promise<Response> {
  const baseUrl = getApiBaseUrl(network);
  const url = `${baseUrl}${endpoint}`;
  return fetch(url, options);
}
