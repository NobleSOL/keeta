import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const ROUTER_ABI = [
  "function feeRecipient() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function factory() view returns (address)",
  "function WETH() view returns (address)",
];

async function main() {
  const rpcUrl = process.env.RPC_URL || "https://base-sepolia-rpc.publicnode.com";
  const routerAddress = process.env.UNIFIED_ROUTER_ADDRESS;

  if (!routerAddress) {
    throw new Error("UNIFIED_ROUTER_ADDRESS not set in .env");
  }

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const router = new ethers.Contract(routerAddress, ROUTER_ABI, provider);

  console.log(`\n🔍 Verifying Router at: ${routerAddress}`);
  console.log("=====================================");

  try {
    const feeRecipient = await router.feeRecipient();
    const feeBps = await router.feeBps();
    const factory = await router.factory();
    const weth = await router.WETH();

    console.log(`Fee Recipient: ${feeRecipient}`);
    console.log(`Fee BPS: ${feeBps} (${Number(feeBps) / 100}%)`);
    console.log(`Factory: ${factory}`);
    console.log(`WETH: ${weth}`);

    // Check if it matches expected values
    const expectedFeeRecipient = process.env.FEE_RECIPIENT;
    const expectedFactory = process.env.FACTORY_ADDRESS;
    const expectedWeth = process.env.WETH_ADDRESS;

    console.log("\n✅ Validation:");
    console.log(`Fee Recipient matches: ${feeRecipient.toLowerCase() === expectedFeeRecipient?.toLowerCase()}`);
    console.log(`Factory matches: ${factory.toLowerCase() === expectedFactory?.toLowerCase()}`);
    console.log(`WETH matches: ${weth.toLowerCase() === expectedWeth?.toLowerCase()}`);
  } catch (error: any) {
    console.error("❌ Error:", error.message);
  }
}

main().catch(console.error);
