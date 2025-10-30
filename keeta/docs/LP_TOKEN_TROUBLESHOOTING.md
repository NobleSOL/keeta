# 🔍 LP Token Creation - How It Works & Troubleshooting

## 📚 How LP Tokens Are Created from a Pair

Based on the code in this chat, here's exactly how LP tokens work:

---

## 🎯 LP Token Creation Formula

### First Liquidity Add (Empty Pool)
```javascript
// Location: keeta/src/utils/math.js - calculateLPTokensToMint()

if (totalSupply === 0n) {
  // Use geometric mean: sqrt(amountA * amountB)
  const product = amountA * amountB;
  const liquidity = sqrt(product);
  
  // Lock minimum liquidity (prevents division by zero attacks)
  const MINIMUM_LIQUIDITY = 1000n;
  
  return liquidity - MINIMUM_LIQUIDITY;
}
```

**Example:**
```javascript
// First add: 1 KTA + 10,000 SBCK
const amountA = 1_000_000_000n;  // 1 KTA (9 decimals)
const amountB = 10_000_000_000_000n;  // 10,000 SBCK (9 decimals)

const product = 1_000_000_000n * 10_000_000_000_000n;
// = 10_000_000_000_000_000_000_000n

const liquidity = sqrt(product);
// = 100_000_000_000n (100 LP tokens with 9 decimals)

const lpTokens = liquidity - 1000n;
// = 99_999_999_000n (99.999999 LP tokens)
// 1000 wei locked forever
```

### Subsequent Liquidity Adds (Pool Has Liquidity)
```javascript
// Use proportional calculation
const liquidityA = (amountA * totalSupply) / reserveA;
const liquidityB = (amountB * totalSupply) / reserveB;

// Return the minimum to ensure both ratios are maintained
return liquidityA < liquidityB ? liquidityA : liquidityB;
```

**Example:**
```javascript
// Pool state: 1 KTA, 10,000 SBCK, 100 LP tokens
// User adds: 0.5 KTA, 5,000 SBCK

const reserveA = 1_000_000_000n;
const reserveB = 10_000_000_000_000n;
const totalSupply = 100_000_000_000n;

const amountA = 500_000_000n;  // 0.5 KTA
const amountB = 5_000_000_000_000n;  // 5,000 SBCK

const liquidityA = (500_000_000n * 100_000_000_000n) / 1_000_000_000n;
// = 50_000_000_000n (50 LP tokens)

const liquidityB = (5_000_000_000_000n * 100_000_000_000n) / 10_000_000_000_000n;
// = 50_000_000_000n (50 LP tokens)

// Both equal, so user gets 50 LP tokens
// New total: 150 LP tokens
// User owns: 50/150 = 33.33% of pool
```

---

## 🏗️ Full Process in Pool.js

### addLiquidity Method
```javascript
// Location: keeta/src/contracts/Pool.js

async addLiquidity(userAddress, amountADesired, amountBDesired, amountAMin, amountBMin) {
  // 1. Update reserves from blockchain
  await this.updateReserves();
  
  // 2. Calculate optimal amounts (maintains ratio)
  const { amountA, amountB } = calculateOptimalLiquidityAmounts(
    amountADesired,
    amountBDesired,
    this.reserveA,
    this.reserveB
  );
  
  // 3. Check slippage protection
  if (amountA < amountAMin) throw new Error('Insufficient token A');
  if (amountB < amountBMin) throw new Error('Insufficient token B');
  
  // 4. Calculate LP tokens to mint
  const liquidity = calculateLPTokensToMint(
    amountA,
    amountB,
    this.reserveA,
    this.reserveB,
    this.totalLPSupply  // ← Current total LP supply
  );
  
  // 5. Execute on-chain transaction
  builder.send(poolAccount, amountA, tokenAAccount);  // User → Pool
  builder.send(poolAccount, amountB, tokenBAccount);  // User → Pool
  await client.publishBuilder(builder);
  
  // 6. Update in-memory LP tracking
  this.totalLPSupply += liquidity;  // ← Increment total supply
  const currentLP = this.lpHolders.get(userAddress) || 0n;
  this.lpHolders.set(userAddress, currentLP + liquidity);  // ← Track user balance
  
  // 7. Update reserves
  await this.updateReserves();
  
  return { amountA, amountB, liquidity };
}
```

---

## 🐛 Common Issues & Solutions

### Issue 1: "Insufficient initial liquidity"

**Error:**
```javascript
Error: Insufficient initial liquidity
```

**Cause:**
The geometric mean is too small (≤ 1000 wei).

**Solution:**
```javascript
// First liquidity must satisfy: sqrt(amountA * amountB) > 1000

// ❌ BAD: Too small
addLiquidity(1n, 1n)  // sqrt(1) = 1 < 1000

// ✅ GOOD: Large enough
addLiquidity(1_000_000_000n, 10_000_000_000_000n)
// sqrt(10^22) = 10^11 > 1000
```

**Fix in your code:**
```javascript
// Ensure amounts are in atomic units with proper decimals
const amountA = toAtomic('1', 9);  // 1 KTA = 1_000_000_000
const amountB = toAtomic('10000', 9);  // 10000 SBCK = 10_000_000_000_000
```

### Issue 2: LP Tokens Not Tracking

**Symptom:**
LP tokens calculated but not showing up.

**Cause:**
`totalLPSupply` and `lpHolders` are in-memory only, not persisted.

**Current Code:**
```javascript
// Pool.js constructor
this.totalLPSupply = 0n;  // ← Lost on restart
this.lpHolders = new Map();  // ← Lost on restart
```

**Solution A: Add Persistence**
```javascript
// In PoolManager.js, save LP data to .pools.json
async savePools() {
  const poolsData = this.pools.map(pool => ({
    address: pool.poolAddress,
    tokenA: pool.tokenA,
    tokenB: pool.tokenB,
    totalLPSupply: pool.totalLPSupply.toString(),  // ← Add this
    lpHolders: Array.from(pool.lpHolders.entries()).map(([addr, bal]) => ({
      address: addr,
      balance: bal.toString()
    }))  // ← Add this
  }));
  
  await fs.writeFile('.pools.json', JSON.stringify({ pools: poolsData }, null, 2));
}

async loadPools() {
  const data = JSON.parse(await fs.readFile('.pools.json'));
  
  for (const poolData of data.pools) {
    const pool = new Pool(poolData.address, poolData.tokenA, poolData.tokenB);
    await pool.initialize();
    
    // Restore LP data
    pool.totalLPSupply = BigInt(poolData.totalLPSupply || '0');
    if (poolData.lpHolders) {
      poolData.lpHolders.forEach(holder => {
        pool.lpHolders.set(holder.address, BigInt(holder.balance));
      });
    }
    
    this.pools.push(pool);
  }
}
```

**Solution B: Query from Blockchain**
```javascript
// Better approach: Store LP tokens on-chain
// Create a token for each pool

async addLiquidity(userAddress, amountA, amountB, ...) {
  // ... existing code ...
  
  // Mint LP tokens as actual Keeta tokens
  const lpTokenAddress = this.lpTokenAddress;  // Pool's LP token
  builder.mint(userAccount, liquidity, lpTokenAddress);
  
  // Now LP balances are stored on-chain
  // Can query anytime: client.getBalance(userAddress, lpTokenAddress)
}
```

### Issue 3: Second Liquidity Add Fails

**Error:**
```javascript
Error: Optimal amounts calculation failed
```

**Cause:**
Amounts don't maintain pool ratio.

**Example:**
```javascript
// Pool: 1 KTA, 10,000 SBCK (ratio 1:10,000)
// User tries: 1 KTA, 5,000 SBCK (ratio 1:5,000) ❌

// Optimal B = (amountA * reserveB) / reserveA
//           = (1 * 10,000) / 1 = 10,000
// User provided 5,000 < 10,000 ❌

// Optimal A = (amountB * reserveA) / reserveB
//           = (5,000 * 1) / 10,000 = 0.5
// User provided 1 > 0.5 ❌

// Neither works!
```

**Solution:**
```javascript
// Provide amounts in correct ratio, or let contract adjust

// Option 1: Calculate correct ratio yourself
const ratio = reserveB / reserveA;  // 10,000
const amountA = 1_000_000_000n;  // 1 KTA
const amountB = amountA * ratio;  // 10,000 SBCK ✅

// Option 2: Provide excess, contract uses optimal
await addLiquidity(
  userAddress,
  1_000_000_000n,      // Desired A
  15_000_000_000_000n, // Desired B (excess)
  0n,                  // Min A
  0n                   // Min B
);
// Contract uses: 1 KTA + 10,000 SBCK
// Returns unused: 5,000 SBCK
```

### Issue 4: LP Calculation Returns 0

**Symptom:**
```javascript
liquidity === 0n
```

**Cause:**
Integer division rounding down to zero.

**Example:**
```javascript
// Pool: 100 KTA, 1,000,000 SBCK, 10,000 LP
// User adds: 0.001 KTA, 10 SBCK

const liquidityA = (1_000_000n * 10_000_000_000_000n) / 100_000_000_000n;
// = 100_000_000n (0.1 LP tokens)

const liquidityB = (10_000_000_000n * 10_000_000_000_000n) / 1_000_000_000_000_000n;
// = 100_000_000n (0.1 LP tokens)

// But if amounts are even smaller:
const tiny = (100n * 10_000_000_000_000n) / 100_000_000_000n;
// = 10_000n → Rounds to 0.00001 LP

// If less than 1 wei, becomes 0!
```

**Solution:**
```javascript
// Enforce minimum liquidity add
const MIN_LP_MINT = 1000n;  // Minimum 1000 wei LP tokens

if (liquidity < MIN_LP_MINT) {
  throw new Error(`Liquidity too small: ${liquidity} < ${MIN_LP_MINT}`);
}
```

### Issue 5: totalLPSupply Never Initialized

**Symptom:**
```javascript
// First add works
// Second add fails: "Cannot read property of undefined"
```

**Cause:**
Pool object not properly initialized.

**Solution:**
```javascript
// In PoolManager.loadPools()
const pool = new Pool(address, tokenA, tokenB);
await pool.initialize();  // ← MUST call this!

// Pool.initialize() sets:
// - decimalsA, decimalsB
// - reserveA, reserveB
// - Ready for use

// Without initialize():
// - decimalsA = null ❌
// - reserveA = 0n ❌
// - Calculations fail ❌
```

---

## ✅ Correct Implementation Example

```javascript
// Complete flow that works:

// 1. Create pool
const poolManager = new PoolManager(client, opsSeed, treasurySeed);
const pool = await poolManager.createPool(tokenA, tokenB, 0.3);

// 2. First liquidity add (empty pool)
const result1 = await pool.addLiquidity(
  userAddress,
  1_000_000_000n,      // 1 KTA (with 9 decimals)
  10_000_000_000_000n, // 10,000 SBCK (with 9 decimals)
  0n,
  0n
);
console.log('First add LP tokens:', result1.liquidity);
// LP = sqrt(1e9 * 1e13) - 1000 = sqrt(1e22) - 1000
//    = 100_000_000_000 - 1000 = 99_999_999_000 wei
//    = 99.999999 LP tokens

// 3. Second liquidity add (pool has liquidity)
const result2 = await pool.addLiquidity(
  userAddress,
  500_000_000n,        // 0.5 KTA
  5_000_000_000_000n,  // 5,000 SBCK (maintains 1:10,000 ratio)
  0n,
  0n
);
console.log('Second add LP tokens:', result2.liquidity);
// LP = min(
//   (0.5e9 * 100e9) / 1e9,
//   (5000e9 * 100e9) / 10000e9
// ) = min(50e9, 50e9) = 50_000_000_000 wei = 50 LP tokens

// 4. Pool state
console.log('Total LP supply:', pool.totalLPSupply);
// = 99_999_999_000 + 50_000_000_000 = 149_999_999_000 wei
// = 149.999999 LP tokens

console.log('User LP balance:', pool.lpHolders.get(userAddress));
// = 149.999999 LP tokens (user did both adds)

console.log('User ownership:', 
  Number(pool.lpHolders.get(userAddress)) / Number(pool.totalLPSupply) * 100
);
// = 100% (only user in pool)
```

---

## 🔧 Debugging Checklist

When LP tokens aren't working, check:

**1. Pool Initialization**
```javascript
// ❌ Wrong
const pool = new Pool(address, tokenA, tokenB);
await pool.addLiquidity(...);  // FAIL: not initialized

// ✅ Correct
const pool = new Pool(address, tokenA, tokenB);
await pool.initialize();  // Must call first!
await pool.addLiquidity(...);  // Now works
```

**2. Atomic Units**
```javascript
// ❌ Wrong: Using decimal values
await pool.addLiquidity(user, 1, 10000, 0, 0);  // Too small!

// ✅ Correct: Using atomic units (9 decimals for Keeta)
await pool.addLiquidity(
  user,
  1_000_000_000n,      // 1.0 KTA
  10_000_000_000_000n, // 10000.0 SBCK
  0n,
  0n
);
```

**3. First vs Subsequent Adds**
```javascript
// First add uses: sqrt(amountA * amountB)
// Subsequent adds use: proportional to reserves

// Check which path is being taken:
console.log('Total LP supply before:', pool.totalLPSupply);
// If 0n → First add (sqrt formula)
// If > 0n → Subsequent add (proportional formula)
```

**4. LP Tracking Persistence**
```javascript
// LP data is in-memory by default!
// Check if it persists:

// Before restart
console.log('LP before:', pool.totalLPSupply);  // 100e9

// After restart (without saving)
const pool2 = await poolManager.loadPools();
console.log('LP after:', pool2.totalLPSupply);  // 0n ❌

// Fix: Implement savePools()/loadPools() with LP data
```

**5. Math Overflow/Underflow**
```javascript
// Check for division by zero
if (reserveA === 0n && reserveB === 0n && totalSupply > 0n) {
  throw new Error('Invalid state: reserves empty but LP exists');
}

// Check for overflow (should be fine with BigInt)
const product = amountA * amountB;
console.log('Product:', product);  // Should not throw
```

---

## 📝 Summary

**LP Token Creation:**
- **First add:** `sqrt(amountA * amountB) - 1000` (geometric mean)
- **Subsequent:** `min(amountA * total / reserveA, amountB * total / reserveB)` (proportional)

**Key Points:**
1. LP tokens represent proportional ownership of pool
2. First 1000 wei locked forever (prevents attacks)
3. Amounts must maintain pool ratio for subsequent adds
4. LP data is in-memory by default (add persistence!)
5. Always use atomic units (with proper decimals)
6. Must call `pool.initialize()` before use

**Your Issue:**
Likely one of these:
1. ❌ Pool not initialized before use
2. ❌ LP data not persisting (restart loses it)
3. ❌ Using decimal instead of atomic units
4. ❌ Wrong ratio for subsequent add
5. ❌ `totalLPSupply` not tracking correctly

**Quick Fix:**
Check your bootstrap script and make sure LP data persists to `.pools.json`!
