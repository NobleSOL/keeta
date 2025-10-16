import { ethers } from "ethers";
import fs from "fs";
import path from "path";

// Usage:
//   node scripts/deploy-silverback-v2.ts <RPC_URL> <PRIVATE_KEY> [WETH]
// Defaults:
//   WETH (Base): 0x4200000000000000000000000000000000000006
// Notes:
// - Compile the contracts with your toolchain (foundry/hardhat) so artifacts exist under
//   artifacts/contracts/<Name>.sol/<Name>.json
// - This script deploys:
//   1) SilverbackV2FactoryV2(feeToSetter=deployer, initialFeeTo=FEE_WALLET)
//   2) SilverbackV2RouterV2(factory, WETH)
// - Prints verify arguments for BaseScan

const FEE_WALLET = "0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7"; // protocol fee wallet
const DEFAULT_WETH = "0x4200000000000000000000000000000000000006"; // Base WETH

function readArtifact(name: string) {
  const p = path.resolve(
    __dirname,
    `../artifacts/contracts/${name}.sol/${name}.json`,
  );
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

async function main() {
  const [rpcUrl, pk, wethArg] = process.argv.slice(2);
  if (!rpcUrl || !pk) throw new Error("Args: <RPC_URL> <PRIVATE_KEY> [WETH]");
  const WETH = wethArg || DEFAULT_WETH;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  // Factory
  const facArtifact = readArtifact("SilverbackV2FactoryV2");
  const FactoryCF = new ethers.ContractFactory(
    facArtifact.abi,
    facArtifact.bytecode,
    wallet,
  );
  console.log("Deploying SilverbackV2FactoryV2...", {
    feeToSetter: await wallet.getAddress(),
    initialFeeTo: FEE_WALLET,
  });
  const factory = await FactoryCF.deploy(
    await wallet.getAddress(),
    FEE_WALLET,
  );
  console.log("tx:", factory.deploymentTransaction()?.hash);
  const factoryAddr = await factory.getAddress();
  console.log("Factory:", factoryAddr);

  // Router
  const rArtifact = readArtifact("SilverbackV2RouterV2");
  const RouterCF = new ethers.ContractFactory(rArtifact.abi, rArtifact.bytecode, wallet);
  console.log("Deploying SilverbackV2RouterV2...", { factory: factoryAddr, WETH });
  const router = await RouterCF.deploy(factoryAddr, WETH);
  console.log("tx:", router.deploymentTransaction()?.hash);
  const routerAddr = await router.getAddress();
  console.log("Router:", routerAddr);

  console.log("\nVerify commands (BaseScan):");
  console.log("Factory:");
  console.log("  Address:", factoryAddr);
  console.log("  Constructor args (JSON):", JSON.stringify([await wallet.getAddress(), FEE_WALLET]));
  console.log("Router:");
  console.log("  Address:", routerAddr);
  console.log("  Constructor args (JSON):", JSON.stringify([factoryAddr, WETH]));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
