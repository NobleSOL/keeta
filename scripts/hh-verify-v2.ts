import hre from "hardhat";

// Usage:
//   pnpm hardhat run scripts/hh-verify-v2.ts --network base-sepolia -- <factoryAddr> <routerAddr> <feeToSetter> <weth>
// Notes:
// - Factory constructor: (feeToSetter)
// - feeTo is not a constructor arg in contractsV2; set via setFeeTo after deploy

async function main() {
  const [factoryAddr, routerAddr, feeToSetter, weth] = process.argv.slice(2);
  if (!factoryAddr || !routerAddr || !feeToSetter || !weth) {
    throw new Error(
      "Args: <factoryAddr> <routerAddr> <feeToSetter> <weth>",
    );
  }

  console.log("Verifying SilverbackFactory...", factoryAddr);
  await hre.run("verify:verify", {
    address: factoryAddr,
    constructorArguments: [feeToSetter],
    contract: "contractsV2/SilverbackFactory.sol:SilverbackFactory",
  });

  console.log("Verifying SilverbackRouter...", routerAddr);
  await hre.run("verify:verify", {
    address: routerAddr,
    constructorArguments: [factoryAddr, weth],
    contract: "contractsV2/SilverbackRouter.sol:SilverbackRouter",
  });

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
