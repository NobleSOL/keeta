import * as KeetaNet from "@keetanetwork/keetanet-client";
import { withCors } from "./utils/cors.js";

// Use exports from top-level KeetaNet
const { AccountKeyAlgorithm } = KeetaNet.lib.Account;
const { Permissions } = KeetaNet.lib;
import {
  EXECUTE_TRANSACTIONS,
  DEFAULT_FACTORY_ACCOUNT,
  accountToString,
  appendEvent,
  canonicalTokenOrder,
  calculateLiquidityMint,
  createClient,
  decodeFactoryMetadataFromInfo,
  encodeFactoryMetadata,
  encodePoolMetadata,
  formatAmount,
  loadTokenDetails,
  nowSeconds,
  toRawAmount,
} from "./utils/keeta.js";

const STORAGE_PERMISSIONS = new Permissions([
  "ACCESS",
  "STORAGE_CAN_HOLD",
  "STORAGE_DEPOSIT",
]);

const TOKEN_PERMISSIONS = new Permissions(["ACCESS"]);

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function parseInteger(value, label, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    throw new Error(`${label} must be an integer`);
  }
  if (parsed < min || parsed > max) {
    throw new Error(`${label} must be between ${min} and ${max}`);
  }
  return parsed;
}

async function createPoolHandler(event) {
  if (event.httpMethod && event.httpMethod.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  let client;
  try {
    const payload = parseBody(event.body);
    const {
      seed,
      accountIndex: rawAccountIndex = 0,
      baseToken: baseTokenInput,
      baseTokenAccount,
      quoteToken,
      quoteTokenAccount,
      amountBase,
      amountQuote,
      customFeeBps,
      lpTokenDecimals: rawLpDecimals = 9,
      poolName,
      paused = false,
      factoryAccount: factoryAccountInput,
    } = payload;

    if (!seed || typeof seed !== "string") {
      throw new Error("A signer seed is required to create a pool");
    }

    const accountIndex = parseInteger(rawAccountIndex, "accountIndex", { min: 0 }) ?? 0;
    const lpDecimals = parseInteger(rawLpDecimals, "lpTokenDecimals", { min: 0, max: 18 }) ?? 9;

    const factoryAccountAddress =
      normalizeString(factoryAccountInput) || normalizeString(DEFAULT_FACTORY_ACCOUNT);
    if (!factoryAccountAddress) {
      throw new Error("A factory account must be provided to create a pool");
    }

    const quoteTokenAddress = normalizeString(quoteTokenAccount || quoteToken);
    if (!quoteTokenAddress) {
      throw new Error("quoteTokenAccount is required");
    }

    if (!amountBase || !amountQuote) {
      throw new Error("Both amountBase and amountQuote are required");
    }

    const creator = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
    client = await createClient({ seed, accountIndex });

    const factoryAccount = KeetaNet.lib.Account.toAccount(factoryAccountAddress);
    const factoryInfo = await client.client.getAccountInfo(factoryAccount);
    const factoryConfig = decodeFactoryMetadataFromInfo(factoryInfo) || {
      version: 1,
      authority: accountToString(factoryAccount),
      defaultFeeBps: 30,
      allowCustomFees: true,
      creationFee: "0",
      creationFeeToken: "KTA",
      totalPools: 0,
      paused: false,
    };

    if (factoryConfig.paused) {
      throw new Error("Factory is paused. Pool creation is disabled");
    }

    const requestedFeeBps =
      customFeeBps === undefined || customFeeBps === null
        ? undefined
        : Number(customFeeBps);
    if (
      requestedFeeBps !== undefined &&
      (!Number.isFinite(requestedFeeBps) || !Number.isInteger(requestedFeeBps))
    ) {
      throw new Error("customFeeBps must be an integer between 0 and 10_000");
    }

    if (requestedFeeBps !== undefined && !factoryConfig.allowCustomFees) {
      throw new Error("Factory does not allow custom fee tiers");
    }

    const feeBps =
      requestedFeeBps !== undefined ? requestedFeeBps : factoryConfig.defaultFeeBps ?? 30;
    if (feeBps < 0 || feeBps > 10_000) {
      throw new Error("Fee basis points must be between 0 and 10_000");
    }

    const baseTokenAddress = normalizeString(baseTokenAccount || baseTokenInput);

    const baseAccount = baseTokenAddress
      ? KeetaNet.lib.Account.toAccount(baseTokenAddress)
      : client.baseToken;
    const quoteAccount = KeetaNet.lib.Account.toAccount(quoteTokenAddress);

    const baseDetails = await loadTokenDetails(client, baseAccount);
    const quoteDetails = await loadTokenDetails(client, quoteAccount);

    const amountBaseRaw = toRawAmount(amountBase, baseDetails.decimals);
    const amountQuoteRaw = toRawAmount(amountQuote, quoteDetails.decimals);

    if (amountBaseRaw <= 0n || amountQuoteRaw <= 0n) {
      throw new Error("Initial liquidity amounts must be greater than zero");
    }

    const canonical = canonicalTokenOrder(baseAccount, quoteAccount);
    const baseAmountRaw = canonical.swapped ? amountQuoteRaw : amountBaseRaw;
    const quoteAmountRaw = canonical.swapped ? amountBaseRaw : amountQuoteRaw;

    const mintedInfo = calculateLiquidityMint(
      baseAmountRaw,
      quoteAmountRaw,
      0n,
      0n,
      0n
    );
    const minted = mintedInfo.minted;
    if (minted <= 0n) {
      throw new Error("Initial deposit is too small to mint LP tokens");
    }

    const builder = client.initBuilder();
    const poolIdentifier = builder.generateIdentifier(AccountKeyAlgorithm.STORAGE);
    const lpIdentifier = builder.generateIdentifier(AccountKeyAlgorithm.TOKEN);
    const feeVaultBaseIdentifier = builder.generateIdentifier(AccountKeyAlgorithm.STORAGE);
    const feeVaultQuoteIdentifier = builder.generateIdentifier(AccountKeyAlgorithm.STORAGE);

    // Must call computeBlocks() before accessing .account on PendingAccount
    await builder.computeBlocks();

    const poolAccount = poolIdentifier.account;
    const lpTokenAccount = lpIdentifier.account;
    const feeVaultBaseAccount = feeVaultBaseIdentifier.account;
    const feeVaultQuoteAccount = feeVaultQuoteIdentifier.account;

    const timestamp = nowSeconds();
    const poolEvent = {
      type: "PoolCreated",
      timestamp,
      creator: accountToString(creator),
      baseDeposit: baseAmountRaw.toString(),
      quoteDeposit: quoteAmountRaw.toString(),
      lpMinted: minted.toString(),
    };

    const poolState = appendEvent(
      {
        version: 1,
        factory: accountToString(factoryAccount),
        baseToken: canonical.baseKey,
        quoteToken: canonical.quoteKey,
        feeBps,
        lpToken: accountToString(lpTokenAccount),
        feeVaultBase: accountToString(feeVaultBaseAccount),
        feeVaultQuote: accountToString(feeVaultQuoteAccount),
        reserveBase: baseAmountRaw.toString(),
        reserveQuote: quoteAmountRaw.toString(),
        lpSupply: minted.toString(),
        accruedFeeBase: "0",
        accruedFeeQuote: "0",
        paused: Boolean(paused),
        createdBy: accountToString(creator),
        createdAt: timestamp,
        lpDecimals,
      },
      poolEvent
    );

    // Set pool account info with STORAGE_PERMISSIONS BEFORE sending tokens to it
    builder.setInfo(
      {
        name: poolName ?? `POOL_${canonical.baseKey}_${canonical.quoteKey}`,
        description: "Permissionless FX pool managed by the Silverback factory.",
        metadata: encodePoolMetadata(poolState),
        defaultPermission: STORAGE_PERMISSIONS,
      },
      { account: poolAccount }
    );

    // Set LP token info with TOKEN_PERMISSIONS BEFORE minting
    builder.setInfo(
      {
        name: `${poolName ?? "FX"}_LP`,
        description: `LP token for ${canonical.baseKey}/${canonical.quoteKey}`,
        metadata: Buffer.from(JSON.stringify({
          pool: accountToString(poolAccount),
          decimals: lpDecimals,
          factory: accountToString(factoryAccount),
        })).toString('base64'),
        defaultPermission: TOKEN_PERMISSIONS,
      },
      { account: lpTokenAccount }
    );

    // Now that permissions are set, perform transfers
    builder.send(poolAccount, baseAmountRaw, canonical.base);
    builder.send(poolAccount, quoteAmountRaw, canonical.quote);

    builder.modifyTokenSupply(minted, { account: lpTokenAccount });
    builder.receive(poolAccount, minted, lpTokenAccount, true);

    const updatedFactoryConfig = {
      ...factoryConfig,
      totalPools: (factoryConfig.totalPools ?? 0) + 1,
      latestEvent: poolEvent,
    };

    builder.setInfo(
      {
        name: factoryInfo?.info?.name || "SILVERBACK_FX_FACTORY",
        description:
          factoryInfo?.info?.description ||
          "Permissionless Anchor FX factory deployed on Keeta.",
        metadata: encodeFactoryMetadata(updatedFactoryConfig),
      },
      { account: factoryAccount }
    );

    let execution = {};
    if (EXECUTE_TRANSACTIONS) {
      try {
        execution = {
          blocks: await client.computeBuilderBlocks(builder),
          published: await client.publishBuilder(builder),
        };
      } catch (error) {
        execution = { error: error.message };
      }
    }

    const response = {
      factory: {
        address: accountToString(factoryAccount),
        config: updatedFactoryConfig,
      },
      pool: {
        address: accountToString(poolAccount),
        baseToken: canonical.baseKey,
        quoteToken: canonical.quoteKey,
        lpToken: accountToString(lpTokenAccount),
        feeVaultBase: accountToString(feeVaultBaseAccount),
        feeVaultQuote: accountToString(feeVaultQuoteAccount),
        state: poolState,
      },
      deposits: {
        base: {
          symbol: baseDetails.symbol,
          address: baseDetails.address,
          amountRaw: baseAmountRaw.toString(),
          amountFormatted: formatAmount(baseAmountRaw, baseDetails.decimals),
        },
        quote: {
          symbol: quoteDetails.symbol,
          address: quoteDetails.address,
          amountRaw: quoteAmountRaw.toString(),
          amountFormatted: formatAmount(quoteAmountRaw, quoteDetails.decimals),
        },
      },
      minted: {
        raw: minted.toString(),
        formatted: formatAmount(minted, lpDecimals),
        share: Number.isFinite(mintedInfo.share)
          ? Number((mintedInfo.share * 100).toFixed(6))
          : 100,
      },
      execution: {
        attempted: EXECUTE_TRANSACTIONS,
        ...execution,
      },
      message: execution.error
        ? `Pool prepared but transaction failed: ${execution.error}`
        : EXECUTE_TRANSACTIONS
        ? "Pool creation transaction prepared"
        : "Pool creation prepared. Set KEETA_EXECUTE_TRANSACTIONS=1 to broadcast automatically.",
    };

    return {
      statusCode: 200,
      body: JSON.stringify(response),
    };
  } catch (error) {
    console.error("createPool error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Failed to create pool" }),
    };
  } finally {
    if (client && typeof client.destroy === "function") {
      try {
        await client.destroy();
      } catch (destroyError) {
        console.warn("Failed to destroy Keeta client", destroyError);
      }
    }
  }
}

export const handler = withCors(createPoolHandler);
