# Silverback DEX — Frontend + Contracts

Production-ready swap UI (React/Vite + wagmi) with token address import, slippage dialog, wallet balances, OpenOcean quotes, and Liquidity page. This repo also ships minimal on-chain contracts to collect a protocol fee and (optionally) run a simple V2 AMM under the Silverback brand.

## Contents
- Frontend (client/*): swap, liquidity, wallet, slippage, token selector (with OpenOcean Base token list)
- Contracts (contracts/*):
  - `SilverbackRouter.sol` — protocol-fee router and swap forwarder (ETH/ERC20, EIP-2612 permit, slippage check, dust refunds)
  - `SilverbackV2Factory.sol` — V2 factory (pair deployment)
  - `SilverbackV2Pair.sol` — V2 constant-product LP token (0.3% pool fee to LPs)
  - `SilverbackV2Router.sol` — minimal V2 router with WETH support (add/remove liquidity and simple 2-token swap)
  - `interfaces.sol` — shared interfaces + `SilverbackV2Library`
- Scripts:
  - `scripts/deploy-silverback-router.ts` — example deploy script for the Router using Hardhat/ethers

## Addresses you should know (Base)
- WETH (Base): `0x4200000000000000000000000000000000000006`
- Silverback fee recipient (configured in code): `0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7`

---

## Contract Overview

### 1) SilverbackRouter (protocol fee + forwarder)
- Deducts `feeBps` from user input to `feeRecipient`, then forwards user-provided calldata to any AMM/aggregator (e.g., OpenOcean, Uniswap routers, Aerodrome).
- Supports native ETH and ERC20 inputs; optional EIP‑2612 `permit` variant.
- Verifies `minAmountOut` by sweeping post-call output difference to the recipient.
- Emits `SwapForwarded`.

Constructor args:
- `feeRecipient`: address
- `feeBps`: uint16 (max 1000 = 10%)

Core entry:
- `swapAndForward(SwapParams p)` and `swapAndForward(SwapParams p, PermitData permit)`

### 2) Silverback V2 AMM (optional, if you want your own pools)
- `SilverbackV2Factory` — deploys `SilverbackV2Pair` LPs and tracks `getPair(tokenA, tokenB)`
- `SilverbackV2Pair` — constant-product pool with 0.3% swap fee to LPs
- `SilverbackV2Router` — minimal router with methods:
  - `addLiquidity`, `removeLiquidity`
  - `swapExactTokensForTokens` (simple 2-hop)

Note: This V2 set is intentionally minimal to get you started; production features like feeTo/farm/distribution can be extended.

---

## Deploy with Remix (recommended for quick start)

1) Open Remix, create files under `contracts/` and paste:
   - `contracts/SilverbackRouter.sol`
   - (optional V2) `contracts/SilverbackV2Factory.sol`, `contracts/SilverbackV2Pair.sol`, `contracts/SilverbackV2Router.sol`, `contracts/interfaces.sol`

2) Compile with Solidity 0.8.20 (enable optimizer if desired).

3) Deploy SilverbackRouter:
   - Constructor:
     - `feeRecipient`: `0x360c2eB71dd6422AC1a69FbBCA278FFc2280f8F7`
     - `feeBps`: `30` (0.30%)

4) (Optional) Deploy V2 AMM:
   - Deploy `SilverbackV2Factory` with `feeToSetter = your EOA`.
   - Deploy `SilverbackV2Router` with:
     - `_factory = <SilverbackV2Factory address>`
     - `_WETH = 0x4200000000000000000000000000000000000006` (Base WETH)
   - To create a pair: call `factory.createPair(tokenA, tokenB)`.
   - To add liquidity: `router.addLiquidity(tokenA, tokenB, amountA, amountB, amountAMin, amountBMin, to, deadline)`.

5) (If using Uniswap V3 periphery on Base) — create a V3 pool through an existing `NonfungiblePositionManager` (NFPM) by calling `createAndInitializePoolIfNecessary(token0, token1, fee, sqrtPriceX96)`.

---

## Deploy with Hardhat (optional)

1) Install Hardhat in a separate environment or this repo if you add configs.
2) Compile contracts to produce artifacts under `artifacts/`.
3) Run the provided script:
```
node scripts/deploy-silverback-router.ts https://mainnet.base.org <PRIVATE_KEY> 30
```
Outputs the deployed `SilverbackRouter` address.

---

## Frontend wiring (Vite env)
Set the following in your environment (e.g., `.env`, Netlify/Vercel env, or project settings):
```
VITE_SB_V2_FACTORY=<address>         # if you deployed V2 factory
VITE_SB_V2_ROUTER=<address>          # if you deployed V2 router
VITE_V3_NFPM=<address>               # existing NonfungiblePositionManager if using V3
VITE_V3_FACTORY=<address>            # optional
VITE_BASE_RPC_URL=https://mainnet.base.org
VITE_WALLETCONNECT_PROJECT_ID=<id>
```
The Liquidity page supports:
- Creating a V2 pair via `createPair` (and then adding liquidity)
- Creating a V3 pool via NFPM `createAndInitializePoolIfNecessary` (fee tier input is supported)

OpenOcean quotes are used for price preview; swaps can be executed via `SilverbackRouter.swapAndForward` once you feed it the returned `to/data/value` (with our fee set to "deduct-before").

---

## How swaps work end-to-end
1) Frontend gets a quote from OpenOcean `v4/base/quote`.
2) Build the exact calldata (OpenOcean `swap` endpoint returns `to`, `data`, `value`).
3) User approves input token (if ERC20) to `SilverbackRouter`.
4) Call `swapAndForward` with:
   - `inToken`, `outToken`, `amountIn`, `minAmountOut`, `deadline`, `target` = `to` from OpenOcean, `data` = payload, `sweep = true`.
5) Router deducts our `feeBps`, forwards the call, then sweeps out tokens to the user.

---

## Notes & Safety
- This code is provided as a starting point. Audit before mainnet use.
- Fee logic is protocol-wide in `SilverbackRouter` and not embedded in pool math.
- V3 support here assumes an existing NFPM on Base; deploying a bespoke Silverback V3 suite would require additional contracts (pool deployer, periphery, etc.).

## License
MIT
