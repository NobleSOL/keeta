# Keeta DEX White Paper

**A Permissionless Decentralized Exchange with Multi-LP Architecture**

Version 1.0 - 2025

---

## Abstract

Keeta DEX introduces a novel approach to decentralized exchanges by implementing a permissionless multi-liquidity provider (multi-LP) architecture. Unlike traditional AMMs where liquidity is pooled into a single contract, Keeta DEX allows multiple users to provide liquidity to the same trading pair while maintaining independent ownership and full control of their funds. This architecture combines the efficiency of concentrated liquidity with the security of self-custody, creating a truly decentralized trading experience.

## 1. Introduction

### 1.1 The Problem with Traditional AMMs

Traditional Automated Market Makers (AMMs) like Uniswap V2 face several limitations:

- **Pooled Custody**: All liquidity providers deposit tokens into a single contract, requiring trust in the contract's security
- **Impermanent Loss Risk**: LPs are exposed to losses from price divergence
- **Limited Control**: Once deposited, users cannot directly access their tokens without burning LP shares
- **Capital Inefficiency**: Liquidity is spread across the entire price curve

### 1.2 The Keeta DEX Solution

Keeta DEX addresses these challenges through:

1. **Independent LP Positions**: Each liquidity provider maintains their own storage account with full ownership
2. **Dual-Permission Model**: Users retain control while enabling permissionless swap routing
3. **Proportional Participation**: All LPs participate in swaps proportional to their share
4. **Atomic Transactions**: All operations execute atomically with built-in security guarantees

## 2. Core Architecture

### 2.1 Multi-LP Pool Design

A Keeta DEX pool is not a single contract but rather a **virtual aggregator** that coordinates multiple independent LP positions:

```
Trading Pair: KTA/RIDE
├── LP Storage Account 1 (Alice)
│   ├── 10 KTA
│   └── 50 RIDE
├── LP Storage Account 2 (Bob)
│   ├── 5 KTA
│   └── 25 RIDE
└── LP Storage Account 3 (Carol)
    ├── 2 KTA
    └── 10 RIDE

Total Pool Reserves: 17 KTA + 85 RIDE
```

When a user swaps, the transaction routes proportionally across all three LP accounts based on their share of the total pool.

### 2.2 Storage Account Ownership

Each LP position is represented by a dedicated **storage account** with dual permissions:

**User Permissions (OWNER)**
- Full ownership of the storage account
- Can withdraw tokens at any time
- Complete control without intermediaries

**Operations Permissions (SEND_ON_BEHALF)**
- Enables routing of swaps through the account
- Cannot withdraw or transfer user funds
- Only facilitates trade execution

This model ensures users never lose custody of their funds while enabling seamless swap routing.

### 2.3 Account Roles

**Operations (OPS) Account**
- Orchestrates transactions and pool management
- Creates LP storage accounts for new positions
- Routes swaps across multiple LP accounts
- **Cannot**: Withdraw user funds or modify positions

**Treasury Account**
- Collects protocol fees (0.3% per swap)
- Funds protocol development and maintenance
- Separate from LP earnings

**User Accounts**
- Execute swaps and provide liquidity
- Own their LP storage accounts
- Full withdrawal rights at all times

## 3. How It Works

### 3.1 Providing Liquidity

#### Step 1: Select or Create Pool
Users can add liquidity to any existing trading pair or create a new one. Pool creation is permissionless - anyone can establish a new market.

#### Step 2: Deposit Tokens
Users specify the amount of each token they want to provide. For existing pools, the ratio must match the current pool price to maintain balance.

#### Step 3: Receive LP Shares
The system calculates LP shares based on the deposited amounts:

```
For first liquidity provider:
shares = √(amountA × amountB)

For subsequent providers:
shares = min(
  (amountA × totalShares) / reserveA,
  (amountB × totalShares) / reserveB
)
```

#### Step 4: Storage Account Creation
A dedicated storage account is created for the user's position with:
- User as OWNER (full control)
- OPS with SEND_ON_BEHALF (routing only)
- Tokens deposited directly to user's storage account

#### Example
```
Alice adds liquidity to KTA/RIDE pool:
- Deposits: 10 KTA + 50 RIDE
- Receives: 707,106,781 shares (represents 10% of pool)
- Storage Account: keeta_as4n46...j7try
- Ownership: Alice has full control
```

### 3.2 Executing Swaps

#### The Swap Process

**User Perspective:**
1. Select tokens to swap (e.g., KTA → RIDE)
2. Enter input amount
3. View expected output (after 0.3% fee)
4. Approve and execute transaction
5. Receive output tokens instantly

**Behind the Scenes:**

**Step 1: Fee Collection**
```
Input: 10 KTA
Fee (0.3%): 0.03 KTA → Treasury
After fee: 9.97 KTA
```

**Step 2: Multi-LP Routing**

The swap routes across all LP accounts proportionally:

```
Pool has 3 LPs:
- Alice: 50% of shares → Routes 4.985 KTA through her account
- Bob: 30% of shares → Routes 2.991 KTA through his account
- Carol: 20% of shares → Routes 1.994 KTA through her account

Total: 9.97 KTA input
```

**Step 3: Constant Product Calculation**

For each LP account, calculate output using AMM formula:

```
outputAmount = (inputAmount × reserveOut) / (reserveIn + inputAmount)
```

**Step 4: Token Transfer**

For each LP account:
- User sends their portion of input tokens to LP storage
- OPS routes corresponding output tokens from LP storage to user

**Step 5: Atomic Execution**

All transfers happen in a single atomic transaction - either everything succeeds or everything reverts.

#### Example Transaction
```
User swaps 1 RIDE → KTA in a pool with 2 LPs:

Fee payment:
  User → Treasury: 0.003 RIDE (0.3% fee)

Swap routing:
  LP1 (97.56% of pool):
    User → LP1 Storage: 0.97268 RIDE
    LP1 Storage → User: 0.019439 KTA

  LP2 (2.44% of pool):
    User → LP2 Storage: 0.02432 RIDE
    LP2 Storage → User: 0.000486 KTA

Total received: 0.019925 KTA
```

### 3.3 Removing Liquidity

#### The Withdrawal Process

**Step 1: Select Amount**
Users choose how many LP shares to burn (partial or full withdrawal).

**Step 2: Calculate Proportional Amounts**
```
amountA = (shares × totalReserveA) / totalShares
amountB = (shares × totalReserveB) / totalShares
```

**Step 3: Withdraw Tokens**
User's client directly withdraws tokens from their LP storage account. No OPS approval needed - users have full OWNER permissions.

**Step 4: Burn Shares**
LP shares are burned from the user's position. If all shares are burned, the position is removed from tracking.

#### Example
```
Alice withdraws 50% of her position:
- Burns: 353,553,390 shares (50% of her 707M shares)
- Receives: 5.2 KTA + 24.8 RIDE
- Remaining: 353,553,391 shares (still active in pool)
```

## 4. Economic Model

### 4.1 Fee Structure

**Protocol Fee: 0.3%**
- Collected on the input amount of every swap
- Sent directly to Treasury account
- Used for protocol development, maintenance, and incentives

**No Trading Fees for LPs**
Unlike some AMMs, the 0.3% fee goes entirely to the protocol treasury, not to liquidity providers. LPs earn through a different mechanism.

### 4.2 How Liquidity Providers Earn

LPs earn passively through **price impact** and **arbitrage value**, not direct fee distribution:

#### 1. Price Impact Accumulation

As traders swap, the pool's token ratio shifts. LPs maintain their share percentage, but the underlying token composition changes favorably:

```
Initial State:
Pool: 100 KTA + 500 RIDE
Alice's 10% share: 10 KTA + 50 RIDE

After Trading Activity:
Pool: 102 KTA + 490 RIDE
Alice's 10% share: 10.2 KTA + 49 RIDE

Alice's position gained:
+0.2 KTA (worth ~10 RIDE at current price)
-1 RIDE
Net gain: ~9 RIDE worth of value
```

#### 2. Arbitrage Profit

When external prices diverge from the pool's price, arbitrageurs trade to equalize prices. This trading activity shifts the pool's token composition in favor of LPs:

```
External Price: 1 KTA = 6 RIDE
Pool Price: 1 KTA = 5 RIDE (pool is underpriced)

Arbitrageurs buy KTA from pool:
- Pool gives: KTA (cheap)
- Pool receives: RIDE (at premium)
- Result: Pool accumulates value

LPs benefit proportionally to their share
```

#### 3. Long-Term Value Accumulation

Over time, as trading volume accumulates:
- Numerous small price impacts add up
- Arbitrage opportunities get captured
- LPs' positions appreciate in value

**Profit Realization**: When LPs withdraw, they receive more total value than they deposited (assuming positive trading activity).

### 4.3 Example: LP Profitability

```
Alice's Journey:

Day 1 (Add Liquidity):
- Deposits: 10 KTA + 50 RIDE
- Value: $100 (at $1/KTA, $1/RIDE)
- Shares: 707M (10% of pool)

Day 30 (After Trading Activity):
- Pool reserves shifted due to 10,000+ swaps
- Alice's 10% now represents: 10.5 KTA + 48 RIDE
- Value: $110.50 (KTA rose to $1.10, RIDE stable)
- Profit: $10.50 (10.5% return)

Sources of profit:
- Price impact: $5.50
- Arbitrage capture: $3.00
- KTA price appreciation: $2.00
```

### 4.4 Risk Considerations

**Impermanent Loss**
Like all AMMs, LPs face impermanent loss if token prices diverge significantly:

```
Scenario: KTA price doubles while RIDE stays constant

Initial deposit: 10 KTA + 50 RIDE ($100 total at $1 each)
After price change: 7.07 KTA + 70.7 RIDE ($212 total)
If held instead: 10 KTA + 50 RIDE ($250 total)

Impermanent loss: $38 (15.2%)
```

However, this is offset by:
- Trading fee accumulation (0.3% per swap)
- Price impact profits
- Arbitrage value capture

**Best for**:
- Long-term holders of both tokens
- Believers in trading volume growth
- Users seeking passive yield

## 5. Security & Trust Model

### 5.1 User Fund Security

**Direct Ownership**
Users own their LP storage accounts with OWNER permissions. This means:
- No smart contract can freeze your funds
- No admin keys control your liquidity
- Withdraw at any time without approval

**Limited OPS Access**
The OPS account only has SEND_ON_BEHALF permission, which:
- Allows routing swaps through your storage account
- Cannot withdraw or transfer your funds
- Cannot modify your position

### 5.2 Atomic Transaction Safety

All operations execute atomically using Keeta Network's transaction builder:

```javascript
builder.send(user, treasury, fee, token)       // Fee payment
builder.send(user, lpStorage1, input1, token)  // Swap input
builder.send(lpStorage1, user, output1, token) // Swap output
builder.send(user, lpStorage2, input2, token)  // More routing...
```

Either all operations succeed or all revert - no partial execution.

### 5.3 Slippage Protection

Users specify a minimum acceptable output amount:

```javascript
expectedOutput = 49.5 RIDE
slippageTolerance = 0.5% (user setting)
minimumOutput = 49.5 × (1 - 0.005) = 49.2525 RIDE

If actualOutput < 49.2525 RIDE:
  → Transaction reverts
  → User keeps their input tokens
```

### 5.4 Permission Validation

Keeta Network validates all permission checks before executing transactions:

- Can user send these tokens?
- Does OPS have SEND_ON_BEHALF on this LP account?
- Are balances sufficient for all transfers?

Failed checks result in transaction rejection before any state changes.

## 6. Advantages Over Traditional AMMs

### 6.1 True Self-Custody

**Traditional AMM**:
```
User → Deposit tokens to pool contract
       ↓
     Receive LP tokens (claim on pool)
       ↓
     Trust contract security
```

**Keeta DEX**:
```
User → Deposit tokens to own storage account
       ↓
     Maintain OWNER permissions
       ↓
     Withdraw anytime without approval
```

### 6.2 Permissionless Participation

Anyone can:
- Create new trading pairs
- Add liquidity to existing pools
- Remove liquidity at any time
- No whitelisting or approval required

### 6.3 Proportional Exposure

All LPs participate in every swap proportionally, ensuring:
- Fair distribution of trading volume
- Equal exposure to price impact
- Democratic participation regardless of position size

### 6.4 Transparent Fee Structure

- 0.3% protocol fee clearly displayed
- No hidden fees or MEV extraction
- Treasury usage can be tracked on-chain

### 6.5 Scalability

The architecture supports:
- Unlimited LPs per pool
- Linear scaling of transaction complexity
- Efficient reserve aggregation

## 7. User Experience

### 7.1 Swapping Tokens

1. Visit Keeta DEX interface
2. Select input token and amount (e.g., 10 KTA)
3. Select output token (e.g., RIDE)
4. View expected output: ~49.8 RIDE (after 0.3% fee)
5. Set slippage tolerance (default 0.5%)
6. Click "Swap" and approve transaction
7. Tokens arrive instantly in your wallet

### 7.2 Providing Liquidity

1. Navigate to "Pool" section
2. Choose "Create Pool" or "Select Pool"
3. Enter token amounts (ratio maintained for existing pools)
4. View expected LP shares and pool ownership %
5. Approve token spending
6. Click "Add Liquidity"
7. LP storage account created automatically
8. Position visible in "Your Positions"

### 7.3 Viewing Positions

Dashboard shows:
- All your active LP positions
- Current token balances in each position
- Your % ownership of each pool
- Estimated value (if price feeds available)
- Easy "Add More" or "Withdraw" buttons

### 7.4 Removing Liquidity

1. Open your position
2. Choose withdrawal amount (25%, 50%, 75%, or 100%)
3. View tokens you'll receive
4. Click "Withdraw"
5. Tokens transfer directly from your storage account to wallet
6. No approval needed - you're the owner

## 8. Technical Specifications

### 8.1 Constant Product Formula

Keeta DEX uses the standard AMM constant product formula:

```
x × y = k

Where:
x = reserve of token A
y = reserve of token B
k = constant product

For swap calculations:
outputAmount = (inputAmount × reserveOut) / (reserveIn + inputAmount)
```

### 8.2 Share Calculation

**First Liquidity Provider**:
```
shares = √(amountA × amountB)
```

This geometric mean prevents manipulation of the initial price.

**Subsequent Providers**:
```
shares = min(
  (amountA × totalShares) / reserveA,
  (amountB × totalShares) / reserveB
)
```

Using minimum ensures the ratio is maintained.

### 8.3 Network & Performance

- **Network**: Keeta Network (testnet initially)
- **Transaction Finality**: Sub-second confirmation
- **Gas Model**: Efficient multi-operation batching
- **Scalability**: Supports unlimited concurrent positions

### 8.4 Smart Contract Addresses

*Coming soon - testnet deployment addresses*

## 9. Roadmap

### Phase 1: Core DEX (Current)
- ✅ Multi-LP pool architecture
- ✅ Swap functionality
- ✅ Add/remove liquidity
- ✅ Frontend interface
- ✅ Position tracking

### Phase 2: Enhanced Features (Q2 2025)
- 📋 Analytics dashboard (volume, TVL, APY)
- 📋 Price charts and historical data
- 📋 LP fee distribution (optional protocol upgrade)
- 📋 Multi-hop routing (A→B→C swaps)
- 📋 Token search and discovery

### Phase 3: Advanced Trading (Q3 2025)
- 📋 Limit orders
- 📋 Range orders (concentrated liquidity)
- 📋 Stop-loss functionality
- 📋 Advanced charting tools

### Phase 4: Governance (Q4 2025)
- 📋 Governance token launch
- 📋 DAO structure
- 📋 Protocol parameter voting
- 📋 Treasury management by community

### Phase 5: Cross-Chain (2026)
- 📋 Bridge integration
- 📋 Cross-chain swaps
- 📋 Multi-network liquidity

## 10. Use Cases

### 10.1 Traders
- Swap tokens instantly without counterparty
- No order books or matching delays
- Predictable pricing with slippage protection
- Access to long-tail token pairs

### 10.2 Liquidity Providers
- Earn passive yield from trading activity
- Maintain full control of funds
- Withdraw anytime without lock-up
- Diversified exposure to token pairs

### 10.3 Token Projects
- Create liquid markets for new tokens
- Bootstrap liquidity without centralized exchanges
- Fair price discovery through trading activity
- Permissionless listing

### 10.4 Arbitrageurs
- Profit from price discrepancies
- Efficient cross-DEX arbitrage
- No slippage on large trades (if sufficient liquidity)
- Atomic transaction safety

## 11. Comparison with Competitors

| Feature | Keeta DEX | Uniswap V2 | Uniswap V3 |
|---------|-----------|------------|------------|
| Self-Custody | ✅ Full | ⚠️ Pooled | ⚠️ Pooled |
| Multi-LP | ✅ Yes | ⚠️ Single pool | ⚠️ Single pool |
| Permissionless | ✅ Yes | ✅ Yes | ✅ Yes |
| Capital Efficiency | ⚠️ Standard | ⚠️ Standard | ✅ High |
| Complexity | ✅ Simple | ✅ Simple | ⚠️ Complex |
| Gas Cost | ✅ Low | ✅ Low | ⚠️ High |
| LP Flexibility | ✅ Independent | ⚠️ Locked | ⚠️ Range-bound |

## 12. Getting Started

### 12.1 For Traders

1. **Get a Wallet**: Install a Keeta-compatible wallet
2. **Fund Your Account**: Transfer tokens to your wallet
3. **Visit Keeta DEX**: Navigate to [dex.keeta.network](https://dex.keeta.network)
4. **Connect Wallet**: Click "Connect" and approve connection
5. **Start Trading**: Select tokens and execute swaps

### 12.2 For Liquidity Providers

1. **Acquire Both Tokens**: Ensure you have both tokens in the pair
2. **Choose Pool**: Select existing pool or create new one
3. **Set Amounts**: Enter amounts (maintain ratio for existing pools)
4. **Add Liquidity**: Approve transaction and confirm
5. **Track Position**: Monitor performance in "Your Positions"

### 12.3 Resources

- **Documentation**: [docs.keeta.network/dex](https://docs.keeta.network/dex)
- **Discord**: [discord.gg/keeta](https://discord.gg/keeta)
- **GitHub**: [github.com/keeta/dex](https://github.com/keeta/dex)
- **Twitter**: [@KeetaDEX](https://twitter.com/KeetaDEX)

## 13. FAQ

**Q: What happens if OPS account is compromised?**
A: OPS only has SEND_ON_BEHALF permission, which cannot withdraw user funds. The worst case is swaps stop working until a new OPS account is deployed.

**Q: Can I withdraw my liquidity if the DEX goes offline?**
A: Yes! You own your LP storage account with OWNER permissions. You can withdraw directly using Keeta Network tools, even if the DEX interface is unavailable.

**Q: How is this different from Uniswap?**
A: The key difference is custody. In Uniswap, you deposit tokens to a pool contract. In Keeta DEX, tokens stay in your own storage account that you control.

**Q: What are the risks?**
A: Main risks are impermanent loss (same as any AMM) and smart contract bugs. However, the self-custody model significantly reduces custody risk compared to traditional AMMs.

**Q: Do I earn fees as an LP?**
A: Not directly. The 0.3% protocol fee goes to treasury. LPs earn from price impact accumulation and arbitrage value capture as the pool processes trades.

**Q: Can I provide single-sided liquidity?**
A: Not in the current version. Both tokens are required to maintain the constant product formula. Single-sided liquidity may be added in future versions.

**Q: What's the minimum liquidity amount?**
A: There's no hard minimum, but very small positions may not be cost-effective due to transaction fees. We recommend at least $100 worth of tokens.

**Q: How do I calculate my expected returns?**
A: Returns depend on trading volume, price movements, and impermanent loss. The analytics dashboard (coming Q2 2025) will show historical APY for each pool.

## 14. Conclusion

Keeta DEX represents a fundamental rethinking of decentralized exchange architecture. By combining the efficiency of automated market makers with the security of self-custody, we've created a trading platform that is truly permissionless and trustless.

The multi-LP architecture ensures that providing liquidity doesn't mean giving up control of your funds. Users maintain full ownership while participating in a shared liquidity pool, creating the best of both worlds.

As we continue to develop and expand Keeta DEX, our north star remains constant: **empower users with full control over their funds while providing seamless trading experiences**.

Join us in building the future of decentralized finance.

---

## Legal Disclaimer

This white paper is for informational purposes only and does not constitute financial advice, investment advice, or an offer to sell securities. Cryptocurrency trading involves significant risk and may not be suitable for all investors. Always do your own research and consult with financial professionals before making investment decisions.

Keeta DEX is experimental software currently in testnet. Use at your own risk. The developers make no warranties about the security, functionality, or reliability of the platform.

---

**Version**: 1.0
**Last Updated**: 2025-10-29
**Website**: [keeta.network](https://keeta.network)
**Contact**: team@keeta.network
