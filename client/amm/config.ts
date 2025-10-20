export const SILVERBACK_V2_FACTORY =
  (import.meta as any).env?.VITE_SB_V2_FACTORY || "0x06269F10cfA637866f633bAEF2da42CFF7Fc3a00";
export const SILVERBACK_V2_ROUTER =
  (import.meta as any).env?.VITE_SB_V2_ROUTER || "0x44eB4Bf77a00aF6690e88cD43aa1323B53C03801";

// If using Uniswap V3-like periphery until Silverback V3 is deployed
export const V3_POSITION_MANAGER = (import.meta as any).env?.VITE_V3_NFPM || ""; // NonfungiblePositionManager
export const V3_FACTORY = (import.meta as any).env?.VITE_V3_FACTORY || "";

export function isAddress(v?: string): v is `0x${string}` {
  return !!v && /^0x[a-fA-F0-9]{40}$/.test(v);
}
