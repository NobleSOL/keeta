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

  // Use already deployed factory
  const factoryAddress = "0x9468C256f4e2d01Adfc49DF7CAab92933Ad23a7D";

  // Deploy UnifiedRouter
  console.log("\n📦 Deploying SilverbackUnifiedRouter...");
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

  console.log("⏳ Waiting for deployment...");
  await routerContract.waitForDeployment();
  const routerAddress = await routerContract.getAddress();

  console.log("✅ SilverbackUnifiedRouter deployed at:", routerAddress);
  console.log("   Factory:", factoryAddress);
  console.log("   WETH:", WETH_ADDRESS);
  console.log("   Fee recipient:", deployerAddress);
  console.log("   Fee:", FEE_BPS / 100, "%");

  // Update .env file
  console.log("\n📝 Updating .env file...");
  const envPath = path.resolve(__dirname, "../.env");
  let envContent = fs.readFileSync(envPath, "utf8");

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

  console.log("\n🎉 Deployment Complete!");
  console.log("==========================================");
  console.log("Factory:        ", factoryAddress);
  console.log("UnifiedRouter:  ", routerAddress);
  console.log("==========================================");
}

main().catch((error) => {
  console.error("\n❌ Deployment failed:");
  console.error(error);
  process.exit(1);
});
