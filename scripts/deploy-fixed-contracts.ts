import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

async function main() {
  const RPC_URL = process.env.RPC_URL;
  const PRIVATE_KEY = process.env.PRIVATE_KEY;

  if (!RPC_URL || !PRIVATE_KEY) {
    throw new Error("Missing RPC_URL or PRIVATE_KEY in .env");
  }

  console.log("🌐 Connecting to Base Sepolia...");
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const deployerAddress = wallet.address;

  console.log("👛 Deployer address:", deployerAddress);
  const balance = await provider.getBalance(deployerAddress);
  console.log("💰 Balance:", ethers.formatEther(balance), "ETH");

  // Step 1: Deploy Factory
  console.log("\n📦 Step 1: Deploying SilverbackFactory (with fixed burn)...");
  const factoryArtifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/SilverbackFactory.sol/SilverbackFactory.json"
  );
  const factoryArtifact = JSON.parse(fs.readFileSync(factoryArtifactPath, "utf8"));

  const factoryFactory = new ethers.ContractFactory(
    factoryArtifact.abi,
    factoryArtifact.bytecode,
    wallet
  );

  const factoryContract = await factoryFactory.deploy(deployerAddress);
  await factoryContract.waitForDeployment();
  const factoryAddress = await factoryContract.getAddress();

  console.log("✅ SilverbackFactory deployed at:", factoryAddress);
  console.log("   Fee recipient:", deployerAddress);

  // Step 2: Deploy UnifiedRouter
  console.log("\n📦 Step 2: Deploying SilverbackUnifiedRouter...");
  const routerArtifactPath = path.resolve(
    __dirname,
    "../artifacts/contracts/SilverbackUnifiedRouter.sol/SilverbackUnifiedRouter.json"
  );
  const routerArtifact = JSON.parse(fs.readFileSync(routerArtifactPath, "utf8"));

  const WETH_ADDRESS = "0x4200000000000000000000000000000000000006"; // Base WETH
  const FEE_BPS = 30; // 0.3%

  const routerFactory = new ethers.ContractFactory(
    routerArtifact.abi,
    routerArtifact.bytecode,
    wallet
  );

  const routerContract = await routerFactory.deploy(
    deployerAddress, // fee recipient
    FEE_BPS,
    factoryAddress,
    WETH_ADDRESS
  );
  await routerContract.waitForDeployment();
  const routerAddress = await routerContract.getAddress();

  console.log("✅ SilverbackUnifiedRouter deployed at:", routerAddress);
  console.log("   Factory:", factoryAddress);
  console.log("   WETH:", WETH_ADDRESS);
  console.log("   Fee recipient:", deployerAddress);
  console.log("   Fee:", FEE_BPS / 100, "%");

  // Step 3: Update .env file
  console.log("\n📝 Step 3: Updating .env file...");
  const envPath = path.resolve(__dirname, "../.env");
  let envContent = fs.readFileSync(envPath, "utf8");

  // Update the addresses
  envContent = envContent.replace(
    /VITE_SB_V2_FACTORY=.*/,
    `VITE_SB_V2_FACTORY=${factoryAddress}`
  );
  envContent = envContent.replace(
    /VITE_SB_UNIFIED_ROUTER=.*/,
    `VITE_SB_UNIFIED_ROUTER=${routerAddress}`
  );
  envContent = envContent.replace(
    /VITE_SB_V2_ROUTER=.*/,
    `VITE_SB_V2_ROUTER=${routerAddress}`
  );

  fs.writeFileSync(envPath, envContent);
  console.log("✅ Updated .env with new addresses");

  // Summary
  console.log("\n🎉 Deployment Complete!");
  console.log("==========================================");
  console.log("Factory:        ", factoryAddress);
  console.log("UnifiedRouter:  ", routerAddress);
  console.log("==========================================");
  console.log("\n📋 Next Steps:");
  console.log("1. Verify contracts on Basescan (optional)");
  console.log("2. Deploy frontend to Netlify with updated .env");
  console.log("3. Add liquidity to new pools");
  console.log("\n⚠️  Note: Old liquidity pools still have the burn bug.");
  console.log("   Users cannot remove liquidity from old pools via router.");
  console.log("   All new pools created with the new factory will work correctly.");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:");
  console.error(error);
  process.exit(1);
});
