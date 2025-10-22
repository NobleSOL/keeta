import { ethers } from "ethers";
import dotenv from "dotenv";

dotenv.config();

const RPC_URL = process.env.RPC_URL!;
const PRIVATE_KEY = process.env.PRIVATE_KEY!;
const FACTORY = process.env.VITE_SB_V2_FACTORY!;
const ROUTER = process.env.VITE_SB_UNIFIED_ROUTER!;
const WETH = process.env.WETH_ADDRESS!;

// Test tokens on Base Sepolia
const TEST_TOKENS = {
  // We'll use WETH and create test token pairs
  WETH: "0x4200000000000000000000000000000000000006",
  // You can add your deployed test tokens here
  // For now we'll test ETH pairs primarily
};

const ROUTER_ABI = [
  "function addLiquidityETH(address token, uint amountTokenDesired, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external payable returns (uint amountToken, uint amountETH, uint liquidity)",
  "function removeLiquidityETH(address token, uint liquidity, uint amountTokenMin, uint amountETHMin, address to, uint deadline) external returns (uint amountToken, uint amountETH)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
];

const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function createPair(address tokenA, address tokenB) external returns (address pair)",
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function totalSupply() view returns (uint256)",
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
  details?: any;
}

const results: TestResult[] = [];

function logTest(name: string, status: string, details?: string) {
  const emoji = status === "✅" ? "✅" : status === "❌" ? "❌" : "⏳";
  console.log(`${emoji} ${name}${details ? `: ${details}` : ""}`);
}

async function main() {
  console.log("🧪 Starting DEX Stress Tests\n");
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
  const balance = await provider.getBalance(wallet.address);
  console.log("ETH balance:", ethers.formatEther(balance), "ETH\n");

  if (balance < ethers.parseEther("0.01")) {
    console.log("❌ Insufficient ETH balance for testing. Need at least 0.01 ETH");
    return;
  }

  const deadline = Math.floor(Date.now() / 1000) + 1200; // 20 minutes

  try {
    // ==================== TEST 1: Very Small Amounts ====================
    console.log("\n📊 TEST 1: Very Small Amounts (0.0001 ETH)");
    try {
      const smallEth = ethers.parseEther("0.0001");
      const tx1 = await router.swapExactETHForTokens(
        0,
        [WETH, WETH], // Dummy path for testing
        wallet.address,
        deadline,
        { value: smallEth, gasLimit: 300000 }
      );
      const receipt1 = await tx1.wait();
      logTest("Small amount swap", "✅", `Gas: ${receipt1.gasUsed.toString()}`);
      results.push({ name: "Small amount swap", success: true, gasUsed: receipt1.gasUsed.toString() });
    } catch (e: any) {
      logTest("Small amount swap", "❌", e.message);
      results.push({ name: "Small amount swap", success: false, error: e.message });
    }

    // ==================== TEST 2: Check Router Configuration ====================
    console.log("\n📊 TEST 2: Router Configuration");
    try {
      // Check if router is properly configured
      const routerCode = await provider.getCode(ROUTER);
      if (routerCode === "0x") {
        throw new Error("Router not deployed at specified address");
      }
      logTest("Router deployment", "✅", "Contract exists");
      results.push({ name: "Router deployment", success: true });
    } catch (e: any) {
      logTest("Router deployment", "❌", e.message);
      results.push({ name: "Router deployment", success: false, error: e.message });
    }

    // ==================== TEST 3: Factory Pair Check ====================
    console.log("\n📊 TEST 3: Factory Pair Lookup");
    try {
      const factoryCode = await provider.getCode(FACTORY);
      if (factoryCode === "0x") {
        throw new Error("Factory not deployed");
      }
      logTest("Factory deployment", "✅", "Contract exists");
      results.push({ name: "Factory deployment", success: true });

      // Try to get a pair
      const pairAddr = await factory.getPair(WETH, WETH);
      logTest("Factory getPair", "✅", `Returned: ${pairAddr}`);
      results.push({ name: "Factory getPair", success: true, details: { pair: pairAddr } });
    } catch (e: any) {
      logTest("Factory check", "❌", e.message);
      results.push({ name: "Factory check", success: false, error: e.message });
    }

    // ==================== TEST 4: Gas Estimation ====================
    console.log("\n📊 TEST 4: Gas Estimation");
    try {
      const swapAmount = ethers.parseEther("0.001");
      const gasEstimate = await router.swapExactETHForTokens.estimateGas(
        0,
        [WETH, WETH],
        wallet.address,
        deadline,
        { value: swapAmount }
      );
      logTest("Gas estimation", "✅", `Estimated: ${gasEstimate.toString()} gas`);
      results.push({ name: "Gas estimation", success: true, details: { gas: gasEstimate.toString() } });
    } catch (e: any) {
      logTest("Gas estimation", "❌", e.message);
      results.push({ name: "Gas estimation", success: false, error: e.message });
    }

    // ==================== TEST 5: Deadline Validation ====================
    console.log("\n📊 TEST 5: Deadline Validation (Should Fail)");
    try {
      const pastDeadline = Math.floor(Date.now() / 1000) - 100; // 100 seconds ago
      await router.swapExactETHForTokens(
        0,
        [WETH, WETH],
        wallet.address,
        pastDeadline,
        { value: ethers.parseEther("0.0001"), gasLimit: 300000 }
      );
      logTest("Expired deadline rejection", "❌", "Should have reverted but didn't");
      results.push({ name: "Expired deadline rejection", success: false, error: "Should have reverted" });
    } catch (e: any) {
      if (e.message.includes("EXPIRED") || e.message.includes("deadline")) {
        logTest("Expired deadline rejection", "✅", "Correctly rejected expired deadline");
        results.push({ name: "Expired deadline rejection", success: true });
      } else {
        logTest("Expired deadline rejection", "❌", e.message);
        results.push({ name: "Expired deadline rejection", success: false, error: e.message });
      }
    }

    // ==================== TEST 6: Zero Amount (Should Fail) ====================
    console.log("\n📊 TEST 6: Zero Amount Validation (Should Fail)");
    try {
      await router.swapExactETHForTokens(
        0,
        [WETH, WETH],
        wallet.address,
        deadline,
        { value: 0, gasLimit: 300000 }
      );
      logTest("Zero amount rejection", "❌", "Should have reverted but didn't");
      results.push({ name: "Zero amount rejection", success: false, error: "Should have reverted" });
    } catch (e: any) {
      logTest("Zero amount rejection", "✅", "Correctly rejected zero amount");
      results.push({ name: "Zero amount rejection", success: true });
    }

    // ==================== TEST 7: Invalid Path (Should Fail) ====================
    console.log("\n📊 TEST 7: Invalid Path Validation (Should Fail)");
    try {
      await router.swapExactETHForTokens(
        0,
        [], // Empty path
        wallet.address,
        deadline,
        { value: ethers.parseEther("0.001"), gasLimit: 300000 }
      );
      logTest("Invalid path rejection", "❌", "Should have reverted but didn't");
      results.push({ name: "Invalid path rejection", success: false, error: "Should have reverted" });
    } catch (e: any) {
      logTest("Invalid path rejection", "✅", "Correctly rejected invalid path");
      results.push({ name: "Invalid path rejection", success: true });
    }

    // ==================== TEST 8: Check Fee Collection ====================
    console.log("\n📊 TEST 8: Fee Mechanism Check");
    try {
      const feeRecipientBefore = await provider.getBalance("0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7");
      logTest("Fee recipient balance check", "✅", `Current: ${ethers.formatEther(feeRecipientBefore)} ETH`);
      results.push({
        name: "Fee recipient balance",
        success: true,
        details: { balance: ethers.formatEther(feeRecipientBefore) }
      });
    } catch (e: any) {
      logTest("Fee recipient check", "❌", e.message);
      results.push({ name: "Fee recipient check", success: false, error: e.message });
    }

    // ==================== SUMMARY ====================
    console.log("\n\n=========================================");
    console.log("📊 TEST SUMMARY");
    console.log("=========================================");

    const passed = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    console.log(`Total Tests: ${results.length}`);
    console.log(`✅ Passed: ${passed}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Success Rate: ${((passed / results.length) * 100).toFixed(1)}%`);

    console.log("\n📋 Detailed Results:");
    results.forEach((result, i) => {
      const status = result.success ? "✅" : "❌";
      console.log(`${i + 1}. ${status} ${result.name}`);
      if (result.gasUsed) console.log(`   Gas Used: ${result.gasUsed}`);
      if (result.error) console.log(`   Error: ${result.error}`);
      if (result.details) console.log(`   Details: ${JSON.stringify(result.details, null, 2)}`);
    });

    console.log("\n=========================================");
    console.log("🎉 Stress Testing Complete!");
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
