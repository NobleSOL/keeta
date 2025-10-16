export const SILVERBACK_V2_FACTORY =
  (import.meta as any).env?.VITE_SB_V2_FACTORY || "";
export const SILVERBACK_V2_ROUTER =
  (import.meta as any).env?.VITE_SB_V2_ROUTER ||
  // Base router provided by user (can be overridden via env)
  "0x4752Ba5DbC23F44d87826276Bf6fD6B1c372AD24";

// If using Uniswap V3-like periphery until Silverback V3 is deployed
export const V3_POSITION_MANAGER = (import.meta as any).env?.VITE_V3_NFPM || ""; // NonfungiblePositionManager
export const V3_FACTORY = (import.meta as any).env?.VITE_V3_FACTORY || "";

export function isAddress(v?: string): v is `0x${string}` {
  return !!v && /^0x[a-fA-F0-9]{40}$/.test(v);
}
