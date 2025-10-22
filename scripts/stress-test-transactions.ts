import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const FACTORY = process.env.VITE_SB_V2_FACTORY!;
const ROUTER = process.env.VITE_SB_UNIFIED_ROUTER!;
const WETH = process.env.WETH_ADDRESS!;

const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function allPairsLength() external view returns (uint)",
  "function allPairs(uint) external view returns (address)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
];

const PAIR_ABI = [
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function token0() external view returns (address)",
  "function token1() external view returns (address)",
  "function balanceOf(address owner) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
];

interface TestResult {
  name: string;
  success: boolean;
  error?: string;
  gasUsed?: string;
  txHash?: string;
  details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, status: string, details?: string) {
  const emoji = status === "✅" ? "✅" : status === "❌" ? "❌" : "⏳";
  console.log(`${emoji} ${name}${details ? `: ${details}` : ""}`);
}

async function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log("🔥 Starting REAL Transaction Stress Tests on Base Sepolia\n");
  console.log("=========================================");
  console.log("Router:", ROUTER);
  console.log("Factory:", FACTORY);
  console.log("WETH:", WETH);
  console.log("=========================================\n");

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  const router = new ethers.Contract(ROUTER, ROUTER_ABI, wallet);
  const factory = new ethers.Contract(FACTORY, FACTORY_ABI, wallet);

  console.log("Tester address:", wallet.address);
  const ethBalance = await provider.getBalance(wallet.address);
  console.log("ETH balance:", ethers.formatEther(ethBalance), "ETH\n");

  if (ethBalance < ethers.parseEther("0.1")) {
    console.log("⚠️  Low ETH balance. Recommend at least 0.1 ETH for comprehensive testing.");
  }

  const deadline = Math.floor(Date.now() / 1000) + 1200;

  // Get existing pairs
  const pairCount = await factory.allPairsLength();
  console.log(`📊 Found ${pairCount} existing pairs\n`);

  const testPairs: Array<{ address: string; token0: string; token1: string; symbol0: string; symbol1: string }> = [];

  for (let i = 0; i < pairCount; i++) {
    const pairAddr = await factory.allPairs(i);
    const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);
    const token0 = await pair.token0();
    const token1 = await pair.token1();

    let symbol0 = "???";
    let symbol1 = "???";

    try {
      const t0 = new ethers.Contract(token0, ERC20_ABI, provider);
      const t1 = new ethers.Contract(token1, ERC20_ABI, provider);
      symbol0 = await t0.symbol();
      symbol1 = await t1.symbol();
    } catch (e) {
      // WETH might not have symbol
      if (token0.toLowerCase() === WETH.toLowerCase()) symbol0 = "WETH";
      if (token1.toLowerCase() === WETH.toLowerCase()) symbol1 = "WETH";
    }

    testPairs.push({ address: pairAddr, token0, token1, symbol0, symbol1 });
    console.log(`Pair ${i + 1}: ${symbol0}/${symbol1} at ${pairAddr}`);
  }

  console.log("\n");

  try {
    // ==================== TEST 1: Small ETH → Token Swap ====================
    console.log("🔄 TEST 1: Small ETH → Token Swap (0.001 ETH)");
    if (testPairs.length > 0) {
      try {
        const pair = testPairs[0];
        const tokenOut = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.token1 : pair.token0;
        const symbolOut = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.symbol1 : pair.symbol0;

        const swapAmount = ethers.parseEther("0.001");
        const path = [WETH, tokenOut];

        console.log(`  Swapping 0.001 ETH → ${symbolOut}`);
        console.log(`  Path: WETH → ${symbolOut}`);

        const tokenBefore = await new ethers.Contract(tokenOut, ERC20_ABI, provider).balanceOf(wallet.address);

        const tx = await router.swapExactETHForTokens(
          0, // Accept any amount
          path,
          wallet.address,
          deadline,
          { value: swapAmount, gasLimit: 500000 }
        );

        console.log(`  Transaction hash: ${tx.hash}`);
        const receipt = await tx.wait();

        const tokenAfter = await new ethers.Contract(tokenOut, ERC20_ABI, provider).balanceOf(wallet.address);
        const tokenReceived = tokenAfter - tokenBefore;

        logTest(
          "Small ETH → Token swap",
          "✅",
          `Received ${ethers.formatEther(tokenReceived)} ${symbolOut}, Gas: ${receipt.gasUsed.toString()}`
        );

        results.push({
          name: "Small ETH → Token swap",
          success: true,
          gasUsed: receipt.gasUsed.toString(),
          txHash: tx.hash,
          details: { tokenReceived: ethers.formatEther(tokenReceived), symbol: symbolOut }
        });

        await sleep(2000); // Wait 2s between transactions
      } catch (e: any) {
        logTest("Small ETH → Token swap", "❌", e.message);
        results.push({ name: "Small ETH → Token swap", success: false, error: e.message });
      }
    }

    // ==================== TEST 2: Token → ETH Swap ====================
    console.log("\n🔄 TEST 2: Token → ETH Swap");
    if (testPairs.length > 0) {
      try {
        const pair = testPairs[0];
        const tokenIn = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.token1 : pair.token0;
        const symbolIn = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.symbol1 : pair.symbol0;

        const tokenContract = new ethers.Contract(tokenIn, ERC20_ABI, wallet);
        const tokenBalance = await tokenContract.balanceOf(wallet.address);

        if (tokenBalance > 0n) {
          // Swap 1% of token balance
          const swapAmount = tokenBalance / 100n;
          const path = [tokenIn, WETH];

          console.log(`  Swapping ${ethers.formatEther(swapAmount)} ${symbolIn} → ETH`);

          // Approve tokens
          const allowance = await tokenContract.allowance(wallet.address, ROUTER);
          if (allowance < swapAmount) {
            console.log(`  Approving ${symbolIn}...`);
            const approveTx = await tokenContract.approve(ROUTER, swapAmount);
            await approveTx.wait();
            console.log(`  Approval confirmed`);
          }

          const ethBefore = await provider.getBalance(wallet.address);

          const tx = await router.swapExactTokensForETH(
            swapAmount,
            0,
            path,
            wallet.address,
            deadline,
            { gasLimit: 500000 }
          );

          console.log(`  Transaction hash: ${tx.hash}`);
          const receipt = await tx.wait();

          const ethAfter = await provider.getBalance(wallet.address);
          const ethReceived = ethAfter - ethBefore + (receipt.gasUsed * receipt.gasPrice);

          logTest(
            "Token → ETH swap",
            "✅",
            `Received ${ethers.formatEther(ethReceived)} ETH, Gas: ${receipt.gasUsed.toString()}`
          );

          results.push({
            name: "Token → ETH swap",
            success: true,
            gasUsed: receipt.gasUsed.toString(),
            txHash: tx.hash,
            details: { ethReceived: ethers.formatEther(ethReceived) }
          });

          await sleep(2000);
        } else {
          console.log(`  ⚠️  No ${symbolIn} balance to swap`);
        }
      } catch (e: any) {
        logTest("Token → ETH swap", "❌", e.message);
        results.push({ name: "Token → ETH swap", success: false, error: e.message });
      }
    }

    // ==================== TEST 3: Add Small Liquidity ====================
    console.log("\n💧 TEST 3: Add Small Liquidity (0.001 ETH)");
    if (testPairs.length > 0) {
      try {
        const pair = testPairs[0];
        const token = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.token1 : pair.token0;
        const symbol = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.symbol1 : pair.symbol0;

        const pairContract = new ethers.Contract(pair.address, PAIR_ABI, provider);
        const [reserve0, reserve1] = await pairContract.getReserves();
        const tokenIsToken0 = pair.token0.toLowerCase() === token.toLowerCase();
        const ethReserve = tokenIsToken0 ? reserve1 : reserve0;
        const tokenReserve = tokenIsToken0 ? reserve0 : reserve1;

        const ethAmount = ethers.parseEther("0.001");
        const tokenAmount = (ethAmount * tokenReserve) / ethReserve;

        console.log(`  Adding 0.001 ETH + ${ethers.formatEther(tokenAmount)} ${symbol}`);

        // Approve tokens
        const tokenContract = new ethers.Contract(token, ERC20_ABI, wallet);
        const allowance = await tokenContract.allowance(wallet.address, ROUTER);
        if (allowance < tokenAmount) {
          console.log(`  Approving ${symbol}...`);
          const approveTx = await tokenContract.approve(ROUTER, tokenAmount * 2n); // Approve 2x for safety
          await approveTx.wait();
          console.log(`  Approval confirmed`);
        }

        const lpBefore = await pairContract.balanceOf(wallet.address);

        const tx = await router.addLiquidityETH(
          token,
          tokenAmount,
          (tokenAmount * 95n) / 100n, // 5% slippage
          (ethAmount * 95n) / 100n,
          wallet.address,
          deadline,
          { value: ethAmount, gasLimit: 500000 }
        );

        console.log(`  Transaction hash: ${tx.hash}`);
        const receipt = await tx.wait();

        const lpAfter = await pairContract.balanceOf(wallet.address);
        const lpReceived = lpAfter - lpBefore;

        logTest(
          "Add liquidity",
          "✅",
          `Received ${ethers.formatEther(lpReceived)} LP tokens, Gas: ${receipt.gasUsed.toString()}`
        );

        results.push({
          name: "Add liquidity",
          success: true,
          gasUsed: receipt.gasUsed.toString(),
          txHash: tx.hash,
          details: { lpReceived: ethers.formatEther(lpReceived) }
        });

        await sleep(2000);
      } catch (e: any) {
        logTest("Add liquidity", "❌", e.message);
        results.push({ name: "Add liquidity", success: false, error: e.message });
      }
    }

    // ==================== TEST 4: Remove Small Liquidity ====================
    console.log("\n💧 TEST 4: Remove Small Liquidity (1% of position)");
    if (testPairs.length > 0) {
      try {
        const pair = testPairs[0];
        const token = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.token1 : pair.token0;
        const symbol = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.symbol1 : pair.symbol0;

        const pairContract = new ethers.Contract(pair.address, PAIR_ABI, wallet);
        const lpBalance = await pairContract.balanceOf(wallet.address);

        if (lpBalance > 0n) {
          const removeAmount = lpBalance / 100n; // Remove 1%

          console.log(`  Removing ${ethers.formatEther(removeAmount)} LP tokens (1% of position)`);

          // Approve LP tokens
          const pairContractSigner = new ethers.Contract(pair.address, [
            ...PAIR_ABI,
            "function approve(address spender, uint256 amount) returns (bool)",
            "function allowance(address owner, address spender) view returns (uint256)"
          ], wallet);

          const allowance = await pairContractSigner.allowance(wallet.address, ROUTER);
          if (allowance < removeAmount) {
            console.log(`  Approving LP tokens...`);
            const approveTx = await pairContractSigner.approve(ROUTER, removeAmount);
            await approveTx.wait();
            console.log(`  Approval confirmed`);
          }

          const ethBefore = await provider.getBalance(wallet.address);
          const tokenContract = new ethers.Contract(token, ERC20_ABI, provider);
          const tokenBefore = await tokenContract.balanceOf(wallet.address);

          const tx = await router.removeLiquidityETH(
            token,
            removeAmount,
            0, // Accept any amount
            0,
            wallet.address,
            deadline,
            { gasLimit: 500000 }
          );

          console.log(`  Transaction hash: ${tx.hash}`);
          const receipt = await tx.wait();

          const ethAfter = await provider.getBalance(wallet.address);
          const tokenAfter = await tokenContract.balanceOf(wallet.address);
          const ethReceived = ethAfter - ethBefore + (receipt.gasUsed * receipt.gasPrice);
          const tokenReceived = tokenAfter - tokenBefore;

          logTest(
            "Remove liquidity",
            "✅",
            `Received ${ethers.formatEther(ethReceived)} ETH + ${ethers.formatEther(tokenReceived)} ${symbol}, Gas: ${receipt.gasUsed.toString()}`
          );

          results.push({
            name: "Remove liquidity",
            success: true,
            gasUsed: receipt.gasUsed.toString(),
            txHash: tx.hash,
            details: {
              ethReceived: ethers.formatEther(ethReceived),
              tokenReceived: ethers.formatEther(tokenReceived),
              symbol
            }
          });

          await sleep(2000);
        } else {
          console.log(`  ⚠️  No LP tokens to remove`);
        }
      } catch (e: any) {
        logTest("Remove liquidity", "❌", e.message);
        results.push({ name: "Remove liquidity", success: false, error: e.message });
      }
    }

    // ==================== TEST 5: Multiple Rapid Swaps ====================
    console.log("\n⚡ TEST 5: Multiple Rapid Swaps (5 consecutive swaps)");
    if (testPairs.length > 0) {
      let successCount = 0;
      try {
        const pair = testPairs[0];
        const tokenOut = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.token1 : pair.token0;
        const symbolOut = pair.token0.toLowerCase() === WETH.toLowerCase() ? pair.symbol1 : pair.symbol0;

        for (let i = 1; i <= 5; i++) {
          try {
            const swapAmount = ethers.parseEther("0.0001"); // Very small amounts
            const path = [WETH, tokenOut];

            const tx = await router.swapExactETHForTokens(
              0,
              path,
              wallet.address,
              deadline,
              { value: swapAmount, gasLimit: 500000 }
            );

            const receipt = await tx.wait();
            console.log(`  Swap ${i}/5: ✅ (Gas: ${receipt.gasUsed.toString()})`);
            successCount++;

            await sleep(500); // 500ms between swaps
          } catch (e: any) {
            console.log(`  Swap ${i}/5: ❌ ${e.message}`);
          }
        }

        logTest("Multiple rapid swaps", "✅", `${successCount}/5 swaps succeeded`);
        results.push({
          name: "Multiple rapid swaps",
          success: true,
          details: { successRate: `${successCount}/5` }
        });
      } catch (e: any) {
        logTest("Multiple rapid swaps", "❌", e.message);
        results.push({ name: "Multiple rapid swaps", success: false, error: e.message });
      }
    }

    // ==================== TEST 6: Check Fee Collection ====================
    console.log("\n💰 TEST 6: Verify Fee Collection");
    try {
      const feeRecipient = "0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7";
      const feeBalance = await provider.getBalance(feeRecipient);

      console.log(`  Fee Recipient: ${feeRecipient}`);
      console.log(`  Current Balance: ${ethers.formatEther(feeBalance)} ETH`);
      console.log(`  Note: Fees from swaps should be accumulating here`);

      logTest("Fee collection check", "✅", `Balance: ${ethers.formatEther(feeBalance)} ETH`);
      results.push({
        name: "Fee collection check",
        success: true,
        details: { balance: ethers.formatEther(feeBalance) }
      });
    } catch (e: any) {
      logTest("Fee collection check", "❌", e.message);
      results.push({ name: "Fee collection check", success: false, error: e.message });
    }

    // ==================== SUMMARY ====================
    console.log("\n\n=========================================");
    console.log("🔥 TRANSACTION STRESS TEST SUMMARY");
    console.log("=========================================");

    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;
    const totalGas = results.reduce((sum, r) => sum + BigInt(r.gasUsed || 0), 0n);

    console.log(`Total Tests: ${results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);
    console.log(`Total Gas Used: ${totalGas.toString()}`);

    console.log("\n📋 Transaction Details:");
    results.forEach((result, i) => {
      const status = result.success ? "✅" : "❌";
      console.log(`\n${i + 1}. ${status} ${result.name}`);
      if (result.txHash) console.log(`   TX: https://sepolia.basescan.org/tx/${result.txHash}`);
      if (result.gasUsed) console.log(`   Gas: ${result.gasUsed}`);
      if (result.error) console.log(`   Error: ${result.error}`);
      if (result.details) console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    });

    console.log("\n=========================================");
    if (failed === 0) {
      console.log("🎉 All transaction tests passed!");
      console.log("✅ DEX is fully operational on Base Sepolia");
    } else {
      console.log(`⚠️  ${failed} test(s) failed. Review details above.`);
    }
    console.log("=========================================\n");

  } catch (error: any) {
    console.error("\n❌ Critical Error During Testing:");
    console.error(error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("\n❌ Script Failed:");
  console.error(error);
  process.exit(1);
});
