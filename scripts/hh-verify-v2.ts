import hre from "hardhat";

// Usage:
//   pnpm hardhat run scripts/hh-verify-v2.ts --network base -- <factoryAddr> <routerAddr> <feeToSetter> <feeTo> <weth>
// Example:
//   pnpm hardhat run scripts/hh-verify-v2.ts --network base -- 0xF... 0xR... 0xDEPLOYER 0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7 0x4200000000000000000000000000000000000006

async function main() {
  const [factoryAddr, routerAddr, feeToSetter, feeTo, weth] =
    process.argv.slice(2);
  if (!factoryAddr || !routerAddr || !feeToSetter || !feeTo || !weth) {
    throw new Error(
      "Args: <factoryAddr> <routerAddr> <feeToSetter> <feeTo> <weth>",
    );
  }

  console.log("Verifying FactoryV2...", factoryAddr);
  await hre.run("verify:verify", {
    address: factoryAddr,
    constructorArguments: [feeToSetter, feeTo],
    contract: "contracts/SilverbackV2FactoryV2.sol:SilverbackV2FactoryV2",
  });

  console.log("Verifying RouterV2...", routerAddr);
  await hre.run("verify:verify", {
    address: routerAddr,
    constructorArguments: [factoryAddr, weth],
    contract: "contracts/SilverbackV2RouterV2.sol:SilverbackV2RouterV2",
  });

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
