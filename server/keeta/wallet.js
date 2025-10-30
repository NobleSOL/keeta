import { createHash } from "node:crypto";
import * as KeetaNet from "@keetanetwork/keetanet-client";
import { withCors } from "./utils/cors.js";
import {
  DEFAULT_NETWORK,
  decodeMetadata,
  formatAmount,
  loadOfflinePoolContext,
} from "./utils/keeta.js";

const HEX_SEED_REGEX = /^[0-9a-f]{64}$/i;

const DEFAULT_WALLET_TIMEOUT_MS = (() => {
  const candidates = [
    process.env.KEETA_WALLET_TIMEOUT_MS,
    process.env.KEETA_NETWORK_TIMEOUT_MS,
  ];
  for (const value of candidates) {
    if (value === undefined || value === null || value === "") continue;
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 5000;
})();

const DECIMAL_OVERRIDES = {
  KTA: 9,
  RIDE: 5,
};

function parseBody(body) {
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new Error("Invalid JSON body");
  }
}

function normalizeSeed(seed) {
  if (seed === undefined || seed === null) return "";
  return String(seed).trim();
}

function hashSeedForOffline(seed) {
  const hashed = createHash("sha256").update(seed).digest("hex");
  return hashed.padEnd(64, "0").slice(0, 64);
}

async function attemptWithTimeout(operation, options = {}) {
  const { label = "network operation", timeoutMs = DEFAULT_WALLET_TIMEOUT_MS } =
    options;
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error(`Timed out while waiting for ${label} after ${timeoutMs}ms`)),
      timeoutMs
    );
  });
  const operationPromise = (async () => operation())();

  try {
    const result = await Promise.race([operationPromise, timeoutPromise]);
    return { ok: true, value: result };
  } catch (error) {
    console.warn(`Falling back after ${label} failed`, error);
    operationPromise.catch((lateError) => {
      if (lateError && lateError !== error) {
        console.warn(`Suppressed late failure for ${label}`, lateError);
      }
    });
    return { ok: false, error };
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

const tokenCache = new Map();

async function safeFetch(fn, retries = 2, delay = 400) {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("Unable to complete fetch operation");
}

function deriveAccount(seed, accountIndex, allowOfflineFallback) {
  const normalizedSeed = normalizeSeed(seed);
  if (!normalizedSeed) {
    throw new Error("A wallet seed is required");
  }

  const usableSeed = HEX_SEED_REGEX.test(normalizedSeed)
    ? normalizedSeed
    : allowOfflineFallback
    ? hashSeedForOffline(normalizedSeed)
    : null;

  if (!usableSeed) {
    throw new Error("Provide a 64-character hexadecimal seed");
  }

  // Convert hex string to Buffer for Account.fromSeed
  const seedBuffer = Buffer.from(usableSeed, 'hex');

  return {
    normalizedSeed,
    account: KeetaNet.lib.Account.fromSeed(seedBuffer, accountIndex),
  };
}

function parseAccountIndex(index) {
  if (index === undefined || index === null || index === "") return 0;
  const parsed = Number(index);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error("Account index must be a non-negative integer");
  }
  return parsed;
}

async function loadBaseTokenDetails(client) {
  const info = await safeFetch(() => client.client.getAccountInfo(client.baseToken));
  const metadata = decodeMetadata(info.info.metadata);
  const symbol = metadata.symbol || info.info.name || "KTA";
  const decimals = coerceDecimals(
    symbol,
    metadata.decimalPlaces ?? metadata.decimals ?? 0
  );
  return {
    address: client.baseToken.publicKeyString.get(),
    decimals,
    symbol,
    metadata,
    info: info.info,
  };
}

function coerceDecimals(symbol, chainDecimals) {
  const numeric = Number(chainDecimals);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric;
  }
  const normalizedSymbol = typeof symbol === "string" ? symbol.toUpperCase() : symbol;
  if (
    normalizedSymbol &&
    Object.prototype.hasOwnProperty.call(DECIMAL_OVERRIDES, normalizedSymbol)
  ) {
    const override = Number(DECIMAL_OVERRIDES[normalizedSymbol]);
    return Number.isFinite(override) && override >= 0 ? override : 0;
  }
  return 0;
}

async function getCachedTokenInfo(client, token) {
  const key = token.publicKeyString.get();
  if (tokenCache.has(key)) {
    return tokenCache.get(key);
  }
  const info = await safeFetch(() => client.client.getAccountInfo(token));
  tokenCache.set(key, info);
  return info;
}

async function loadAllTokenBalances(client, account) {
  const balances = await safeFetch(() => client.client.getAllBalances(account));

  const entries = await Promise.all(
    balances.map(async ({ token, balance }) => {
      try {
        const key = token.publicKeyString.get();
        const info = await getCachedTokenInfo(client, token);
        const metadata = decodeMetadata(info.info.metadata);
        const symbol = metadata.symbol || info.info.name || key;
        const decimals = coerceDecimals(
          symbol,
          metadata.decimalPlaces ?? metadata.decimals ?? 0
        );
        const balanceString = balance.toString();

        return {
          symbol,
          address: key,
          decimals,
          balanceRaw: balanceString,
          balanceFormatted: formatAmount(balanceString, decimals),
        };
      } catch (tokenError) {
        console.warn("Failed to parse token info", tokenError);
        return null;
      }
    })
  );

  return entries
    .filter(Boolean)
    .sort((a, b) => {
      if (a.symbol === "KTA") return -1;
      if (b.symbol === "KTA") return 1;
      return a.symbol.localeCompare(b.symbol);
    });
}

async function loadIdentifier(client, account) {
  try {
    const info = await client.client.getAccountInfo(account);
    const metadata = info?.info?.metadata;
    const possibleValues = [
      metadata?.identifierAccount,
      metadata?.identifier,
      metadata?.account,
    ];
    for (const value of possibleValues) {
      if (typeof value === "string") return value;
      if (typeof value === "object") {
        if (typeof value?.address === "string") return value.address;
        if (typeof value?.publicKeyString === "string")
          return value.publicKeyString;
      }
    }
  } catch (infoError) {
    console.warn("Failed to read identifier metadata", infoError);
  }

  try {
    const pending = await client.generateIdentifier(
      KeetaNet.lib.Account.AccountKeyAlgorithm.NETWORK,
      { account }
    );
    return pending.account.publicKeyString.get();
  } catch (error) {
    console.warn("Falling back to account address for identifier", error);
    return account.publicKeyString.get();
  }
}

function buildOfflineWalletResponse({
  normalizedSeed,
  accountIndex,
  account,
  context,
  message,
}) {
  const fallbackContext = context && typeof context === "object" ? context : {};
  const baseTokenContext =
    fallbackContext.baseToken && typeof fallbackContext.baseToken === "object"
      ? fallbackContext.baseToken
      : {};

  const decimalsValue = Number(baseTokenContext.decimals);
  const decimals = Number.isFinite(decimalsValue) && decimalsValue >= 0 ? decimalsValue : 0;

  return {
    seed: normalizedSeed,
    accountIndex,
    address: account.publicKeyString.get(),
    identifier: account.publicKeyString.get(),
    network: fallbackContext.network || DEFAULT_NETWORK,
    baseToken: {
      symbol: baseTokenContext.symbol || "KTA",
      address: baseTokenContext.address || "",
      decimals,
      metadata: baseTokenContext.metadata || {},
      balanceRaw: "0",
      balanceFormatted: "0",
    },
    message:
      message ||
      fallbackContext.message ||
      "Wallet details returned without contacting the network",
  };
}

async function walletHandler(event) {
  if (event.httpMethod && event.httpMethod.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  let client;
  let normalizedSeed = "";
  let accountIndex = 0;
  let account = null;
  let offlineContext = null;
  let lastErrorMessage = "";

  try {
    const payload = parseBody(event.body);
    accountIndex = parseAccountIndex(payload.accountIndex);

    // ✅ If no seed provided, create a new wallet
    if (!payload.seed) {
      const seed = KeetaNet.lib.Account.generateRandomSeed();
      const seedHex = Buffer.from(seed).toString('hex'); // ArrayBuffer → Buffer → hex string
      account = KeetaNet.lib.Account.fromSeed(seed, 0);
      const address = account.publicKeyString.get();

      console.log('🎲 Generated new wallet:');
      console.log('   Seed (hex):', seedHex);
      console.log('   Address:', address);

      return {
        statusCode: 200,
        body: JSON.stringify({
          seed: seedHex, // Convert Buffer to hex string
          accountIndex: 0,
          address,
          identifier: address,
          network: DEFAULT_NETWORK,
          baseToken: {
            symbol: "KTA",
            address: "",
            decimals: 9,
            balanceRaw: "0",
            balanceFormatted: "0",
          },
          message: "New wallet generated",
        }),
      };
    }

    // Otherwise import existing seed
    console.log('🔍 Importing wallet with seed:', payload.seed);
    console.log('   Account index:', accountIndex);

    const derived = deriveAccount(payload.seed, accountIndex, true);
    normalizedSeed = derived.normalizedSeed;
    account = derived.account;

    console.log('   Derived address:', account.publicKeyString.get());

    offlineContext = await loadOfflinePoolContext();

    if (offlineContext) {
      const response = buildOfflineWalletResponse({
        normalizedSeed,
        accountIndex,
        account,
        context: offlineContext,
        message: "Wallet details fetched from offline fixture",
      });
      return { statusCode: 200, body: JSON.stringify(response) };
    }

    client = await KeetaNet.UserClient.fromNetwork(DEFAULT_NETWORK, account);

    const [identifierLookup, baseTokenLookup, tokensLookup] = await Promise.all([
      attemptWithTimeout(() => loadIdentifier(client, account), {
        label: "wallet identifier lookup",
      }),
      attemptWithTimeout(() => loadBaseTokenDetails(client), {
        label: "base token metadata lookup",
      }),
      attemptWithTimeout(() => loadAllTokenBalances(client, account), {
        label: "token balance lookup",
      }),
    ]);

    const identifierAddress = identifierLookup.ok
      ? identifierLookup.value
      : account.publicKeyString.get();

    const baseTokenDetails = baseTokenLookup.ok
      ? baseTokenLookup.value
      : {
          symbol: "KTA",
          address: "",
          decimals: 0,
          metadata: {},
          info: null,
        };

    const tokens = tokensLookup.ok ? tokensLookup.value : [];

    const baseTokenBalanceEntry = tokens.find((token) => {
      if (token.address && baseTokenDetails.address) {
        return token.address === baseTokenDetails.address;
      }
      return token.symbol === baseTokenDetails.symbol;
    });

    const baseTokenBalanceRaw = baseTokenBalanceEntry
      ? baseTokenBalanceEntry.balanceRaw
      : "0";

    const baseTokenBalanceFormatted = baseTokenBalanceEntry
      ? baseTokenBalanceEntry.balanceFormatted
      : formatAmount(baseTokenBalanceRaw, baseTokenDetails.decimals ?? 0);

    const response = {
      seed: normalizedSeed,
      accountIndex,
      address: account.publicKeyString.get(),
      identifier: identifierAddress,
      network: DEFAULT_NETWORK,
      baseToken: {
        symbol: baseTokenDetails.symbol,
        address: baseTokenDetails.address || "",
        decimals: baseTokenDetails.decimals ?? 0,
        metadata: baseTokenDetails.metadata || {},
        balanceRaw: baseTokenBalanceRaw,
        balanceFormatted: baseTokenBalanceFormatted,
      },
      tokens,
    };

    if (!identifierLookup.ok || !baseTokenLookup.ok || !tokensLookup.ok) {
      const missing = [];
      if (!identifierLookup.ok) missing.push("identifier");
      if (!baseTokenLookup.ok) missing.push("base token metadata");
      if (!tokensLookup.ok) missing.push("token balances");
      response.message = `Wallet details returned with fallback values for ${missing.join(", ")}`;
    }

    return { statusCode: 200, body: JSON.stringify(response) };
  } catch (error) {
    lastErrorMessage = error?.message || "";
    console.error("wallet error", error);

    if (account) {
      const response = buildOfflineWalletResponse({
        normalizedSeed,
        accountIndex,
        account,
        context: { network: DEFAULT_NETWORK },
        message: `Wallet details returned without contacting the network (${lastErrorMessage})`,
      });
      return { statusCode: 200, body: JSON.stringify(response) };
    }

    return {
      statusCode: /seed|hex|index/i.test(lastErrorMessage) ? 400 : 500,
      body: JSON.stringify({ error: lastErrorMessage || "Wallet lookup failed" }),
    };
  } finally {
    if (client && typeof client.destroy === "function") {
      const destroyResult = await attemptWithTimeout(() => client.destroy(), {
        label: "Keeta client cleanup",
      });
      if (!destroyResult.ok) {
        console.warn("Failed to destroy Keeta client", destroyResult.error);
      }
    }
  }
}

export const handler = withCors(walletHandler);
