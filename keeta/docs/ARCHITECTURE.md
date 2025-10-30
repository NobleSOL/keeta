# Keeta DEX Architecture

## Overview

Keeta DEX is a permissionless decentralized exchange built on the Keeta Network, featuring a novel multi-LP pool architecture that allows multiple liquidity providers to participate in the same trading pair while maintaining independent ownership of their positions.

## Core Architecture

### 1. Pool Structure

Unlike traditional AMMs that use a single pool contract, Keeta DEX uses a **distributed liquidity model**:

```
Pool (Virtual Aggregator)
├── LP Storage Account 1 (User A)
│   ├── Token A balance
│   └── Token B balance
├── LP Storage Account 2 (User B)
│   ├── Token A balance
│   └── Token B balance
└── LP Storage Account N (User N)
    ├── Token A balance
    └── Token B balance
```

**Key Features:**
- Each liquidity provider has their own storage account
- Pool reserves are aggregated across all LP storage accounts
- Users maintain full ownership of their liquidity
- Permissionless participation - anyone can add liquidity to any pool

### 2. Storage Account Model

#### LP Storage Accounts
Each LP position is represented by a dedicated storage account with dual ownership:

**Ownership Structure:**
- **OWNER permission**: Granted to the liquidity provider
  - Can withdraw funds at any time
  - Full control over their position

- **SEND_ON_BEHALF permission**: Granted to OPS account
  - Enables routing of swaps through the LP account
  - Cannot withdraw funds
  - Only facilitates trades

**Metadata:**
```json
{
  "pool": "KTA_RIDE",
  "owner": "keeta_aab...",
  "createdAt": 1234567890
}
```

**Account Info:**
- Name: `LP_{POOL}_{USER}` (uppercase only)
- Description: Identifies the pool and owner
- Default permissions: `ACCESS`, `STORAGE_CAN_HOLD`

### 3. Account Roles

#### OPS Account
- **Purpose**: Transaction orchestration and pool management
- **Permissions**:
  - Can create LP storage accounts
  - Has `SEND_ON_BEHALF` on all LP storage accounts
  - Routes swaps across multiple LP accounts
- **Cannot**: Withdraw user funds or modify user positions

#### Treasury Account
- **Purpose**: Protocol fee collection
- **Receives**: 0.3% of every swap input amount
- **Usage**: Protocol development, maintenance, incentives

#### User Account
- **Purpose**: Execute swaps and provide liquidity
- **Owns**: Their LP storage accounts with full withdrawal rights
- **Can**: Add liquidity, remove liquidity, execute swaps

### 4. Pool Management

#### Pool Initialization
```javascript
{
  poolAddress: "keeta_aq...",      // Deterministic pool identifier
  tokenA: "keeta_any...",           // First token (sorted)
  tokenB: "keeta_anc...",           // Second token (sorted)
  symbolA: "KTA",                   // Token A symbol
  symbolB: "RIDE",                  // Token B symbol
  decimalsA: 9,                     // Token A decimals
  decimalsB: 9,                     // Token B decimals
  lpAccounts: Map {                 // All LP positions
    "user_address" => {
      lpStorageAddress: "keeta_as...",
      shares: "707105781",
      amountA: "10000000000",
      amountB: "50000000"
    }
  },
  totalShares: "707105781",         // Sum of all LP shares
  reserveA: "10000000000",          // Aggregated reserve A
  reserveB: "50000000"              // Aggregated reserve B
}
```

#### Reserve Aggregation
Pools calculate total reserves by querying all LP storage accounts:

```javascript
async updateReserves() {
  this.reserveA = 0n;
  this.reserveB = 0n;

  for (const [userAddress, lpAccount] of this.lpAccounts.entries()) {
    const balances = await getBalances(lpAccount.lpStorageAddress);

    const balanceA = balances.find(b => b.token === this.tokenA)?.balance || 0n;
    const balanceB = balances.find(b => b.token === this.tokenB)?.balance || 0n;

    this.reserveA += balanceA;
    this.reserveB += balanceB;
  }
}
```

## Operations

### 1. Add Liquidity

**Flow:**
1. User submits liquidity request with desired amounts
2. System calculates optimal amounts based on current pool ratio
3. OPS creates LP storage account for user (if first position)
4. User's client sends tokens directly to their LP storage account
5. System calculates LP shares using formula: `shares = sqrt(amountA × amountB)`
6. Position saved to `.liquidity-positions-{poolId}.json`

**First Liquidity Provider:**
```javascript
liquidity = sqrt(amountA × amountB)
```

**Subsequent Liquidity Providers:**
```javascript
liquidity = min(
  (amountA × totalShares) / reserveA,
  (amountB × totalShares) / reserveB
)
```

**Key Fields:**
- `lpStorageAddress`: Critical field mapping user to their storage account
- `shares`: User's proportional ownership of the pool
- `amountA` / `amountB`: Initial deposit amounts (for reference)

### 2. Remove Liquidity

**Flow:**
1. User specifies LP shares to burn
2. System calculates proportional token amounts:
   ```javascript
   amountA = (shares × reserveA) / totalShares
   amountB = (shares × reserveB) / totalShares
   ```
3. User's client withdraws tokens from their LP storage account
4. Shares burned from user's position
5. If shares reach 0, position removed from tracking

**User Maintains Control:**
- Users own their LP storage accounts
- Can withdraw at any time without OPS approval
- OPS only facilitates the calculation and coordination

### 3. Swap Execution

**Multi-Step Atomic Transaction:**

#### Step 1: Fee Collection
```javascript
// User sends 0.3% fee to treasury
feeAmount = (inputAmount × 3n) / 1000n
builder.send(
  userAccount,
  treasuryAccount,
  feeAmount,
  inputToken
)
```

#### Step 2: Swap Routing
System routes swap across all LP storage accounts proportionally:

```javascript
for (const [userAddress, lpAccount] of pool.lpAccounts.entries()) {
  const proportion = lpAccount.shares / pool.totalShares
  const inputPortion = afterFeeAmount × proportion

  // Calculate output using constant product formula
  const outputPortion = getAmountOut(inputPortion, reserveIn, reserveOut)

  // User sends input tokens to LP storage
  builder.send(userAccount, lpStorageAccount, inputPortion, inputToken)

  // OPS routes output tokens from LP storage to user
  builder.send(lpStorageAccount, userAccount, outputPortion, outputToken)
}
```

#### Step 3: Transaction Publishing
All operations execute atomically - either all succeed or all fail.

**Constant Product Formula:**
```javascript
getAmountOut(amountIn, reserveIn, reserveOut) {
  const numerator = amountIn × reserveOut
  const denominator = reserveIn + amountIn
  return numerator / denominator
}
```

## Fee Structure

### Protocol Fees
- **Swap Fee**: 0.3% of input amount
- **Recipient**: Treasury account
- **Timing**: Collected upfront before swap execution

### LP Provider Earnings
LPs earn passively through:

1. **Price Impact**:
   - As traders swap, the pool ratio shifts
   - LPs' share percentage stays constant
   - But underlying token composition changes favorably

2. **Arbitrage Value**:
   - Price discrepancies get arbitraged
   - Pool accumulates value from these trades
   - LPs benefit proportionally to their share

3. **No Direct Fee Distribution**:
   - Unlike some AMMs, the 0.3% fee goes to treasury, not LPs
   - LPs earn from holding a share of an appreciating pool
   - When withdrawing, LPs receive more value than deposited (if pool performed well)

**Example:**
```
Initial LP Position:
- Deposit: 10 KTA + 50 RIDE
- Shares: 1000 (10% of pool)

After Trading Activity:
- Pool reserves: 105 KTA + 48 RIDE
- Your shares: Still 1000 (10% of pool)
- Your withdrawal: 10.5 KTA + 4.8 RIDE
- Profit: 0.5 KTA + value from pool performance
```

## Data Persistence

### Position Tracking
Each pool maintains a JSON file tracking all LP positions:

**File**: `.liquidity-positions-{poolId}.json`
```json
{
  "poolAddress": "keeta_aqmb4fwqgytivvvjvwomgs4s2zdpy4drpmzbttjqrgy2fjzpphimztimlcwbk",
  "totalShares": "724783425",
  "positions": {
    "keeta_aabzi2udkrjsc4kcw7ew3wzsbneu2q4bh7ubcj5gbx523k6sklvj2pl4ldlrmpy": {
      "lpStorageAddress": "keeta_as4n46iqjxroequaay3s2buqf32onzecosphf7gw36pjwpfnd457pok4j7try",
      "shares": "707105781",
      "amountA": "9932363329",
      "amountB": "50340485"
    },
    "keeta_aabuf556k7q465i3p6c7xdhirnems2rkgtorfn6j6wwic5iwlo7pjr4h7aolayi": {
      "lpStorageAddress": "keeta_aq7t6wlsrifv42ur5uann6azvdsl3e6ehltw36jpnflvbgum5blfxbux6t4xy",
      "shares": "17677644",
      "amountA": "248309085",
      "amountB": "1258511"
    }
  }
}
```

**Critical Fields:**
- `lpStorageAddress`: Maps user to their on-chain storage account
- `shares`: User's proportional ownership
- `amountA` / `amountB`: Current amounts (updated after swaps)

### Pool Registry
Master list of all pools: `.pools.json`
```json
[
  {
    "poolAddress": "keeta_aqmb4...",
    "tokenA": "keeta_anyiff...",
    "tokenB": "keeta_anchh4...",
    "symbolA": "KTA",
    "symbolB": "RIDE",
    "decimalsA": 9,
    "decimalsB": 9
  }
]
```

## Security Model

### Permission Isolation
- **User Funds**: Stored in user-owned LP storage accounts
- **OPS Access**: Limited to `SEND_ON_BEHALF` (routing only)
- **Treasury Access**: Receives fees but cannot access LP storage accounts

### Atomic Transactions
- All swap operations execute atomically
- Balance changes validated by Keeta Network
- Failed transactions revert completely

### Validation
- Minimum output amounts prevent slippage attacks
- Token approvals verified before execution
- Reserve checks prevent insufficient liquidity errors

## Frontend Integration

### Swap Interface
1. User selects input/output tokens
2. System queries pool reserves
3. Calculates expected output using AMM formula
4. Displays quote with 0.3% fee deducted
5. User approves and executes swap
6. Transaction submitted through user's wallet client

### Liquidity Interface
1. User selects pool or creates new one
2. Inputs desired token amounts
3. System shows expected LP shares
4. User approves token transfers
5. LP storage account created (if first position)
6. Liquidity added and shares allocated

### Portfolio View
- Displays all user LP positions
- Shows current token balances in each position
- Calculates USD value (if price feeds available)
- Provides withdraw/add more liquidity options

## Technical Stack

### Blockchain
- **Network**: Keeta Network (test)
- **Client**: `@keetanetwork/keetanet-client`
- **Account Types**:
  - User accounts (standard)
  - Storage accounts (for LP positions)

### Backend
- **Runtime**: Node.js with ES modules
- **Framework**: Express.js
- **API**: RESTful endpoints for swap/liquidity operations

### Frontend
- **Framework**: React 18 + Vite
- **Styling**: TailwindCSS 3
- **Wallet**: wagmi integration
- **Routing**: React Router 6

## Advanced Features

### Multi-LP Swap Routing
When a swap executes, it routes proportionally across ALL LP providers:

```
User swaps 10 KTA → RIDE in pool with 2 LPs:
├── LP1 (97.56% of pool): Routes 9.756 KTA through their storage
└── LP2 (2.44% of pool): Routes 0.244 KTA through their storage

Each LP's storage account:
- Receives proportional input tokens
- Sends proportional output tokens
- Maintains their share percentage
```

This ensures:
- Fair distribution of swap volume
- All LPs participate in trades
- Proportional exposure to price impact

### Permissionless Pool Creation
Anyone can:
1. Create a new trading pair
2. Be the first LP (set initial ratio)
3. Add liquidity to existing pools
4. Remove liquidity at any time

No admin approval or whitelisting required.

### Slippage Protection
```javascript
// User specifies minimum acceptable output
amountOutMin = expectedOutput × (1 - slippageTolerance)

// Transaction reverts if actual output < minimum
if (actualOutput < amountOutMin) {
  throw new Error('Slippage tolerance exceeded')
}
```

## Deployment Configuration

### Environment Variables
```bash
# OPS account (transaction orchestration)
OPS_SEED=<64-char-hex>

# Treasury account (fee collection)
TREASURY_SEED=<64-char-hex>

# Network configuration
KEETA_NETWORK=test
```

### Token Addresses
Tokens identified by Keeta addresses:
```
KTA:  keeta_anyiff4v34alvumupagmdyosydeq24lc4def5mrpmmyhx3j6vj2uucckeqn52
RIDE: keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo
CAT:  keeta_anotegsofbtcyw3ltsyxegoptxdcb5ykxswvdfvdtojggc3w5aejhdpf453nu
WAVE: keeta_ant6bsl2obpmreopln5e242s3ihxyzjepd6vbkeoz3b3o3pxjtlsx3saixkym
```

## Future Enhancements

### Potential Features
1. **LP Fee Distribution**: Route portion of swap fees directly to LPs
2. **Concentrated Liquidity**: V3-style range orders
3. **Governance**: Token holder voting on protocol parameters
4. **Analytics Dashboard**: Real-time pool statistics and APY calculations
5. **Limit Orders**: Off-chain order matching with on-chain settlement
6. **Multi-hop Routing**: Automatic path finding for best swap rates

### Scalability
- Current architecture supports unlimited LPs per pool
- Gas costs scale linearly with number of LPs
- Consider batching for high-LP pools

## Conclusion

Keeta DEX implements a novel permissionless multi-LP architecture that combines:
- **User sovereignty**: Direct ownership of liquidity positions
- **Permissionless access**: Anyone can provide liquidity
- **Fair distribution**: Proportional swap routing across all LPs
- **Atomic safety**: All-or-nothing transaction execution

This architecture enables a truly decentralized exchange where users maintain full control of their funds while participating in a shared liquidity pool.
