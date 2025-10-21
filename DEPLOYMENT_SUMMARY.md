# Fixed Contract Deployment - Base Sepolia

## Deployment Date
October 21, 2025

## Issue Fixed
Critical bug in `SilverbackPair.sol` burn() function that prevented liquidity removal via router.

**Bug:** Line 138 used `balanceOf[msg.sender]` instead of `balanceOf[address(this)]`
**Impact:** All liquidity removal transactions reverted with "INSUFFICIENT_LIQUIDITY"
**Fix:** Changed to read pair's own LP token balance instead of router's balance

## Deployed Contracts (NEW - Fixed)

### Base Sepolia (Chain ID: 84532)

| Contract | Address | Purpose |
|----------|---------|---------|
| **SilverbackFactory** | `0x9468C256f4e2d01Adfc49DF7CAab92933Ad23a7D` | Creates V2 AMM pairs with fixed burn() |
| **SilverbackUnifiedRouter** | `0x447E415465Af2c932812288af54a22E2C1a80418` | Swap & liquidity router with 0.3% fee |

**Fee Recipient:** `0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7`
**Fee:** 0.3% (30 bps)
**WETH:** `0x4200000000000000000000000000000000000006`

## Old Contracts (Deprecated - Has Bug)

| Contract | Address | Status |
|----------|---------|--------|
| SilverbackFactory (OLD) | `0x06269F10cfA637866f633bAEF2da42CFF7Fc3a00` | ⚠️ Pairs have burn bug |
| SilverbackUnifiedRouter (OLD) | `0x46B7F5427e32AAf3d361199702af00065B61fB82` | ⚠️ Don't use for new pools |

## Migration Guide

### For Users with Existing Liquidity (Old Pools)
❌ **Cannot remove liquidity via router** - Bug prevents this
⚠️ Liquidity is not lost, but stuck until manual intervention

**Options:**
1. Leave liquidity in old pools (continues earning fees from swaps)
2. Manual burn transaction (requires custom contract interaction)
3. Wait for potential migration contract

### For New Liquidity
✅ **Add liquidity to NEW pools only**
- Use updated DEX interface pointing to new contracts
- All new pairs created by new factory work correctly
- Liquidity removal works perfectly

## Code Changes

### contracts/SilverbackPair.sol
```diff
function burn(address to) external override returns (uint256 amount0, uint256 amount1) {
    require(to != address(0), "ZERO_ADDRESS");
    uint256 balance0 = IERC20(token0).balanceOf(address(this));
    uint256 balance1 = IERC20(token1).balanceOf(address(this));
-   uint256 liquidity = balanceOf[msg.sender];
+   uint256 liquidity = balanceOf[address(this)];
    require(liquidity > 0, "INSUFFICIENT_LIQUIDITY");
    amount0 = (liquidity * balance0) / totalSupply;
    amount1 = (liquidity * balance1) / totalSupply;
-   _burn(msg.sender, liquidity);
+   _burn(address(this), liquidity);
    _safeTransfer(token0, to, amount0);
    _safeTransfer(token1, to, amount1);
    _update(IERC20(token0).balanceOf(address(this)), IERC20(token1).balanceOf(address(this)));
    emit Burn(msg.sender, amount0, amount1, to);
}
```

### Removed Files
- Deleted old V2 contract versions (SilverbackV2*.sol)
- Removed SilverbackUnifiedRouterEnhanced.sol
- Cleaned up unused contract artifacts

## Testing Checklist

Before production use:

- [ ] Create new pool (ETH/Token)
- [ ] Add liquidity to new pool
- [ ] Execute swap through new pool
- [ ] Remove liquidity (25%, 50%, 100%)
- [ ] Verify fee collection working
- [ ] Check all transactions on Basescan

## Frontend Updates Required

### Update Netlify Environment Variables
```
VITE_SB_V2_FACTORY=0x9468C256f4e2d01Adfc49DF7CAab92933Ad23a7D
VITE_SB_UNIFIED_ROUTER=0x447E415465Af2c932812288af54a22E2C1a80418
VITE_SB_V2_ROUTER=0x447E415465Af2c932812288af54a22E2C1a80418
```

### Rebuild and Deploy
```bash
pnpm build
# Deploy to Netlify (automatic via git push)
```

## Verification (Optional)

To verify contracts on Basescan:
```bash
npx hardhat verify --network base-sepolia \
  0x9468C256f4e2d01Adfc49DF7CAab92933Ad23a7D \
  "0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7"

npx hardhat verify --network base-sepolia \
  0x447E415465Af2c932812288af54a22E2C1a80418 \
  "0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7" \
  30 \
  "0x9468C256f4e2d01Adfc49DF7CAab92933Ad23a7D" \
  "0x4200000000000000000000000000000000000006"
```

## Next Steps

1. ✅ Contracts deployed with fix
2. ✅ Local .env updated
3. ⏳ Update Netlify environment variables
4. ⏳ Test new pools (add/remove liquidity)
5. ⏳ Announce migration to users
6. ⏳ Optional: Deploy migration helper for old pools

## Support

For issues or questions about the migration:
- Check contract addresses on [Base Sepolia Basescan](https://sepolia.basescan.org/)
- Review transaction logs for errors
- Refer to LIQUIDITY_BUG_REPORT.md for technical details
