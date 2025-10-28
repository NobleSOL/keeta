// src/contracts/Pool.js
import {
  getOpsClient,
  getTreasuryAccount,
  getOpsAccount,
  getBalances,
  accountFromAddress,
  fetchTokenDecimals,
} from '../utils/client.js';
import {
  calculateSwapOutput,
  calculateOptimalLiquidityAmounts,
  calculateLPTokensToMint,
  calculateAmountsForLPBurn,
  calculatePrice,
  calculateMinAmountOut,
} from '../utils/math.js';
import { CONFIG, toAtomic, fromAtomic } from '../utils/constants.js';

/**
 * Represents a liquidity pool for a token pair
 */
export class Pool {
  constructor(poolAddress, tokenA, tokenB, lpTokenAddress = null) {
    this.poolAddress = poolAddress; // Storage account address
    this.tokenA = tokenA; // Token address
    this.tokenB = tokenB; // Token address
    this.lpTokenAddress = lpTokenAddress; // LP token address (created on-demand)
    this.decimalsA = null;
    this.decimalsB = null;
    this.reserveA = 0n;
    this.reserveB = 0n;
  }

  /**
   * Initialize pool by fetching reserves and token info
   */
  async initialize() {
    // Fetch token decimals
    this.decimalsA = await fetchTokenDecimals(this.tokenA);
    this.decimalsB = await fetchTokenDecimals(this.tokenB);

    // Fetch current reserves
    await this.updateReserves();

    // Create LP token if not exists
    if (!this.lpTokenAddress) {
      await this.createLPToken();
    }

    return this;
  }

  /**
   * Create LP token for this pool
   * LP token is a proper token that represents liquidity provider shares
   */
  async createLPToken() {
    const { createTokenAccount } = await import('../utils/client.js');

    // Generate unique LP token symbol from pool address
    // Format: LP_A_[8 chars from pool]
    const poolSuffix = this.poolAddress.replace('keeta_', '').slice(0, 8).toUpperCase();
    const lpTokenSymbol = `LP_A_${poolSuffix}`;
    const lpTokenName = `Silverback LP token for pool ${this.poolAddress.slice(0, 15)}...`;

    console.log(`🏗️ Creating LP token: ${lpTokenSymbol}`);

    this.lpTokenAddress = await createTokenAccount(
      lpTokenSymbol,
      lpTokenName,
      9 // 9 decimals for LP tokens
    );

    console.log(`✅ LP token created at ${this.lpTokenAddress}`);

    return this.lpTokenAddress;
  }

  /**
   * Update reserves from on-chain balances
   */
  async updateReserves() {
    const balances = await getBalances(this.poolAddress);

    const balanceA = balances.find((b) => b.token === this.tokenA);
    const balanceB = balances.find((b) => b.token === this.tokenB);

    this.reserveA = balanceA?.balance ?? 0n;
    this.reserveB = balanceB?.balance ?? 0n;

    return { reserveA: this.reserveA, reserveB: this.reserveB };
  }

  /**
   * Execute a swap
   * 
   * @param {string} userAddress - User's account address
   * @param {string} tokenIn - Input token address
   * @param {bigint} amountIn - Amount of input token (atomic)
   * @param {bigint} minAmountOut - Minimum acceptable output amount (slippage protection)
   * @returns {Promise<{ amountOut: bigint, feeAmount: bigint, txHash: string }>}
   */
  async swap(userAddress, tokenIn, amountIn, minAmountOut = 0n) {
    await this.updateReserves();

    // Determine direction
    const isAtoB = tokenIn === this.tokenA;
    const reserveIn = isAtoB ? this.reserveA : this.reserveB;
    const reserveOut = isAtoB ? this.reserveB : this.reserveA;
    const tokenOut = isAtoB ? this.tokenB : this.tokenA;

    // Calculate output amount with fee
    const { amountOut, feeAmount, priceImpact } = calculateSwapOutput(
      amountIn,
      reserveIn,
      reserveOut,
      CONFIG.SWAP_FEE_BPS
    );

    // Check slippage
    if (amountOut < minAmountOut) {
      throw new Error(
        `Slippage too high: expected min ${minAmountOut}, got ${amountOut}`
      );
    }

    // Build transaction
    const client = await getOpsClient();
    const ops = getOpsAccount();
    const treasury = getTreasuryAccount();
    const builder = client.initBuilder();

    const poolAccount = accountFromAddress(this.poolAddress);
    const tokenInAccount = accountFromAddress(tokenIn);
    const tokenOutAccount = accountFromAddress(tokenOut);
    const userAccount = accountFromAddress(userAddress);

    // 1. User sends input token to pool
    builder.send(poolAccount, amountIn, tokenInAccount);

    // 2. Fee is sent to treasury (in BASE token only for now)
    if (feeAmount > 0n) {
      const feeToken = isAtoB ? this.tokenA : this.tokenA; // Always collect fee in BASE
      const feeTokenAccount = accountFromAddress(feeToken);
      builder.send(treasury, feeAmount, feeTokenAccount, undefined, {
        account: poolAccount,
      });
    }

    // 3. Pool sends output token to user
    builder.send(userAccount, amountOut, tokenOutAccount, undefined, {
      account: poolAccount,
    });

    // Execute transaction
    await client.publishBuilder(builder);

    // Update reserves after swap
    await this.updateReserves();

    // Log swap in explorer-style format and save to transaction history
    await this.logSwapTransaction(userAddress, tokenIn, tokenOut, amountIn, amountOut, priceImpact);

    return {
      amountOut,
      feeAmount,
      priceImpact,
      newReserveA: this.reserveA,
      newReserveB: this.reserveB,
    };
  }

  /**
   * Log swap transaction in explorer style and save to history
   * Example: "4h ago SWAP_FORWARD keet...msamy keet...5hwi 1.000000000 KTA 4.7%"
   */
  async logSwapTransaction(userAddress, tokenIn, tokenOut, amountIn, amountOut, priceImpact) {
    const fromAddr = this.abbreviateAddress(userAddress);
    const toAddr = this.abbreviateAddress(this.poolAddress);
    const amount = (Number(amountIn) / 1e9).toFixed(9);
    const token = this.getTokenSymbol(tokenIn);
    const impact = priceImpact.toFixed(1);

    const logMessage = `now SWAP_FORWARD ${fromAddr} ${toAddr} ${amount} ${token} ${impact}%`;
    console.log(logMessage);

    // Save to transaction history file
    await this.saveTransactionHistory({
      type: 'SWAP_FORWARD',
      timestamp: Date.now(),
      user: userAddress,
      pool: this.poolAddress,
      tokenIn,
      tokenOut,
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      priceImpact: priceImpact.toString(),
    });
  }

  /**
   * Save transaction to history file
   */
  async saveTransactionHistory(transaction) {
    try {
      const fs = await import('fs/promises');
      const historyPath = '.transactions.json';

      let transactions = [];
      try {
        const data = await fs.readFile(historyPath, 'utf8');
        transactions = JSON.parse(data);
      } catch (err) {
        // File doesn't exist yet, start with empty array
      }

      // Add new transaction at the beginning
      transactions.unshift(transaction);

      // Keep only last 1000 transactions
      if (transactions.length > 1000) {
        transactions = transactions.slice(0, 1000);
      }

      await fs.writeFile(historyPath, JSON.stringify(transactions, null, 2));
    } catch (err) {
      console.error('Failed to save transaction history:', err.message);
    }
  }

  /**
   * Abbreviate address (keet...xxxx style)
   */
  abbreviateAddress(address) {
    if (!address || address.length < 15) return address;
    const withoutPrefix = address.replace('keeta_', '');
    const end = withoutPrefix.substring(withoutPrefix.length - 4);
    return `keet...${end}`;
  }

  /**
   * Get token symbol from address
   */
  getTokenSymbol(tokenAddress) {
    const symbols = {
      'keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52': 'KTA',
      'keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo': 'RIDE',
    };
    return symbols[tokenAddress] || 'TOKEN';
  }

  /**
   * Add liquidity to the pool
   * 
   * @param {string} userAddress - User's account address
   * @param {bigint} amountADesired - Desired amount of token A
   * @param {bigint} amountBDesired - Desired amount of token B
   * @param {bigint} amountAMin - Minimum amount of token A (slippage protection)
   * @param {bigint} amountBMin - Minimum amount of token B (slippage protection)
   * @returns {Promise<{ amountA: bigint, amountB: bigint, liquidity: bigint }>}
   */
  async addLiquidity(
    userAddress,
    amountADesired,
    amountBDesired,
    amountAMin = 0n,
    amountBMin = 0n
  ) {
    await this.updateReserves();

    // Calculate optimal amounts
    const { amountA, amountB } = calculateOptimalLiquidityAmounts(
      amountADesired,
      amountBDesired,
      this.reserveA,
      this.reserveB
    );

    // Check minimum amounts
    if (amountA < amountAMin) {
      throw new Error(`Insufficient token A: got ${amountA}, need ${amountAMin}`);
    }
    if (amountB < amountBMin) {
      throw new Error(`Insufficient token B: got ${amountB}, need ${amountBMin}`);
    }

    // Calculate LP tokens to mint
    const totalLPSupply = await this.getTotalLPSupply();
    const liquidity = calculateLPTokensToMint(
      amountA,
      amountB,
      this.reserveA,
      this.reserveB,
      totalLPSupply
    );

    if (liquidity <= 0n) {
      throw new Error('Insufficient liquidity minted');
    }

    // Build transaction
    const client = await getOpsClient();
    const builder = client.initBuilder();

    const poolAccount = accountFromAddress(this.poolAddress);
    const tokenAAccount = accountFromAddress(this.tokenA);
    const tokenBAccount = accountFromAddress(this.tokenB);
    const userAccount = accountFromAddress(userAddress);

    // User sends both tokens to pool
    builder.send(poolAccount, amountA, tokenAAccount);
    builder.send(poolAccount, amountB, tokenBAccount);

    // Mint LP tokens to user (send from pool to user)
    const lpTokenAccount = accountFromAddress(this.lpTokenAddress);
    builder.send(userAccount, liquidity, lpTokenAccount, undefined, {
      account: poolAccount,
    });

    // Execute transaction
    await client.publishBuilder(builder);

    // Update reserves
    await this.updateReserves();

    return {
      amountA,
      amountB,
      liquidity,
      newReserveA: this.reserveA,
      newReserveB: this.reserveB,
    };
  }

  /**
   * Remove liquidity from the pool
   * 
   * @param {string} userAddress - User's account address
   * @param {bigint} liquidity - Amount of LP tokens to burn
   * @param {bigint} amountAMin - Minimum amount of token A to receive
   * @param {bigint} amountBMin - Minimum amount of token B to receive
   * @returns {Promise<{ amountA: bigint, amountB: bigint }>}
   */
  async removeLiquidity(userAddress, liquidity, amountAMin = 0n, amountBMin = 0n) {
    await this.updateReserves();

    // Get user's LP balance from on-chain
    const balances = await getBalances(userAddress);
    const userLPBalance = balances.find((b) => b.token === this.lpTokenAddress);
    const userLP = userLPBalance?.balance ?? 0n;

    if (userLP < liquidity) {
      throw new Error(`Insufficient LP tokens: have ${userLP}, need ${liquidity}`);
    }

    // Get total LP supply from on-chain
    const totalLPSupply = await this.getTotalLPSupply();

    // Calculate amounts to return
    const { amountA, amountB } = calculateAmountsForLPBurn(
      liquidity,
      totalLPSupply,
      this.reserveA,
      this.reserveB
    );

    // Check minimum amounts
    if (amountA < amountAMin) {
      throw new Error(`Insufficient token A: got ${amountA}, need ${amountAMin}`);
    }
    if (amountB < amountBMin) {
      throw new Error(`Insufficient token B: got ${amountB}, need ${amountBMin}`);
    }

    // Build transaction
    const client = await getOpsClient();
    const builder = client.initBuilder();

    const poolAccount = accountFromAddress(this.poolAddress);
    const tokenAAccount = accountFromAddress(this.tokenA);
    const tokenBAccount = accountFromAddress(this.tokenB);
    const userAccount = accountFromAddress(userAddress);

    // User burns LP tokens (sends back to pool)
    const lpTokenAccount = accountFromAddress(this.lpTokenAddress);
    builder.send(poolAccount, liquidity, lpTokenAccount);

    // Pool sends both tokens back to user
    builder.send(userAccount, amountA, tokenAAccount, undefined, {
      account: poolAccount,
    });
    builder.send(userAccount, amountB, tokenBAccount, undefined, {
      account: poolAccount,
    });

    // Execute transaction
    await client.publishBuilder(builder);

    // Update reserves
    await this.updateReserves();

    return {
      amountA,
      amountB,
      newReserveA: this.reserveA,
      newReserveB: this.reserveB,
    };
  }

  /**
   * Get total LP supply from on-chain balances
   * LP tokens in circulation = LP tokens held by users (not in pool account)
   */
  async getTotalLPSupply() {
    // Query all LP token holders and sum their balances
    // For now, we can calculate it as: total minted - tokens held by pool
    const poolBalances = await getBalances(this.poolAddress);
    const poolLPBalance = poolBalances.find((b) => b.token === this.lpTokenAddress);
    const lpInPool = poolLPBalance?.balance ?? 0n;

    // In Keeta, total supply = amount NOT in the pool (since pool mints by sending)
    // We need to track total minted separately, or query all holders
    // For simplicity, we'll use the pool's LP balance as proxy for now
    // Total circulating = initial amount - amount in pool
    // This assumes we started with a large initial supply in the pool

    // For now, return 0 if no LP tokens exist yet
    if (lpInPool === 0n) {
      return 0n;
    }

    // Calculate total supply (this is a simplified version)
    // In production, you'd track this differently
    return lpInPool;
  }

  /**
   * Get current pool state
   */
  async getPoolInfo() {
    await this.updateReserves();

    const price = calculatePrice(
      this.reserveA,
      this.reserveB,
      this.decimalsA,
      this.decimalsB
    );

    const totalLPSupply = await this.getTotalLPSupply();

    return {
      poolAddress: this.poolAddress,
      tokenA: this.tokenA,
      tokenB: this.tokenB,
      reserveA: this.reserveA.toString(),
      reserveB: this.reserveB.toString(),
      reserveAHuman: fromAtomic(this.reserveA, this.decimalsA),
      reserveBHuman: fromAtomic(this.reserveB, this.decimalsB),
      totalLPSupply: totalLPSupply.toString(),
      lpTokenAddress: this.lpTokenAddress,
      priceAtoB: price.priceAtoB,
      priceBtoA: price.priceBtoA,
      decimalsA: this.decimalsA,
      decimalsB: this.decimalsB,
    };
  }

  /**
   * Get quote for a swap (without executing)
   */
  async getSwapQuote(tokenIn, amountIn) {
    await this.updateReserves();

    const isAtoB = tokenIn === this.tokenA;
    const reserveIn = isAtoB ? this.reserveA : this.reserveB;
    const reserveOut = isAtoB ? this.reserveB : this.reserveA;
    const decimalsIn = isAtoB ? this.decimalsA : this.decimalsB;
    const decimalsOut = isAtoB ? this.decimalsB : this.decimalsA;

    const { amountOut, feeAmount, priceImpact } = calculateSwapOutput(
      amountIn,
      reserveIn,
      reserveOut,
      CONFIG.SWAP_FEE_BPS
    );

    // Calculate with 0.5% slippage
    const minAmountOut = calculateMinAmountOut(amountOut, 0.5);

    return {
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountInHuman: fromAtomic(amountIn, decimalsIn),
      amountOutHuman: fromAtomic(amountOut, decimalsOut),
      feeAmount: feeAmount.toString(),
      feeAmountHuman: fromAtomic(feeAmount, decimalsIn),
      priceImpact: priceImpact.toFixed(4),
      minAmountOut: minAmountOut.toString(),
      minAmountOutHuman: fromAtomic(minAmountOut, decimalsOut),
    };
  }

  /**
   * Get user's LP position
   */
  async getUserLPBalance(userAddress) {
    // Get user's LP balance from on-chain
    const balances = await getBalances(userAddress);
    const userLPBalance = balances.find((b) => b.token === this.lpTokenAddress);
    const lpBalance = userLPBalance?.balance ?? 0n;

    // Get total LP supply
    const totalLPSupply = await this.getTotalLPSupply();

    if (lpBalance === 0n || totalLPSupply === 0n) {
      return {
        lpBalance: '0',
        sharePercent: 0,
        amountA: '0',
        amountB: '0',
      };
    }

    const { amountA, amountB } = calculateAmountsForLPBurn(
      lpBalance,
      totalLPSupply,
      this.reserveA,
      this.reserveB
    );

    const sharePercent = (Number(lpBalance) / Number(totalLPSupply)) * 100;

    return {
      lpBalance: lpBalance.toString(),
      sharePercent: sharePercent.toFixed(4),
      amountA: amountA.toString(),
      amountB: amountB.toString(),
      amountAHuman: fromAtomic(amountA, this.decimalsA),
      amountBHuman: fromAtomic(amountB, this.decimalsB),
    };
  }
}
