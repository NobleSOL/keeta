/* global BigInt */
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import * as KeetaNet from "@keetanetwork/keetanet-client";

const NETWORK_ALIASES = {
  testnet: "test",
};

const FILE_MODULE_PATH = fileURLToPath(import.meta.url);
const FILE_MODULE_DIR = path.dirname(FILE_MODULE_PATH);
const DEFAULT_OFFLINE_FIXTURE_PATH = path.resolve(
  FILE_MODULE_DIR,
  "../fixtures/poolContext.json"
);

const DEFAULT_ANCHORS_FIXTURE_PATH = path.resolve(
  FILE_MODULE_DIR,
  "../fixtures/anchors.json"
);

const USE_OFFLINE_FIXTURE = /^1|true$/i.test(
  process.env.KEETA_USE_OFFLINE_FIXTURE || ""
);

function normalizeNetworkName(network) {
  if (!network) {
    return "test";
  }
  const normalized = String(network).trim().toLowerCase();
  if (!normalized) {
    return "test";
  }
  return NETWORK_ALIASES[normalized] || normalized;
}

const DEFAULT_NETWORK = normalizeNetworkName(process.env.KEETA_NETWORK || "test");
const DEFAULT_POOL_ACCOUNT =
  process.env.KEETA_POOL_ACCOUNT ||
  "keeta_atki2vx75726w2ez75dbl662t7rhlcbhhvgsps4srwymwzvldrydhzkrl4fng";
const DEFAULT_LP_TOKEN_ACCOUNT =
  process.env.KEETA_LP_TOKEN_ACCOUNT ||
  "keeta_amdjie4di55jfnbh7vhsiophjo27dwv5s4qd5qf7p3q7rppgwbwowwjw6zsfs";
const DEFAULT_FACTORY_ACCOUNT = process.env.KEETA_FACTORY_ACCOUNT || "";

const STATIC_TOKEN_ADDRESSES = {
  RIDE: "keeta_anchh4m5ukgvnx5jcwe56k3ltgo4x4kppicdjgcaftx4525gdvknf73fotmdo",
};

const TOKEN_DECIMAL_OVERRIDES = {};

const EXECUTE_TRANSACTIONS = /^1|true$/i.test(
  process.env.KEETA_EXECUTE_TRANSACTIONS || ""
);

let cachedOfflineFixture = null;
let cachedOfflineFixturePath = null;

let cachedAnchorsFixture = null;
let cachedAnchorsFixturePath = null;

function deepClone(value) {
  if (value === undefined || value === null) {
    return value;
  }
  return JSON.parse(JSON.stringify(value));
}

function parseJsonBody(body) {
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body === "object") {
    return body;
  }

  const input = String(body).trim();
  if (!input) {
    return {};
  }

  try {
    const parsed = JSON.parse(input);
    if (parsed && typeof parsed === "object") {
      return parsed;
    }
    return {};
  } catch (error) {
    throw new Error("Invalid JSON body");
  }
}

function toBigIntSafe(value) {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new TypeError("Numeric values must be finite integers");
    }
    if (Math.abs(value) > Number.MAX_SAFE_INTEGER) {
      throw new RangeError("Numeric values must be within the safe integer range");
    }
    return BigInt(value);
  }

  if (typeof value === "string") {
    const normalized = value.trim();
    if (!normalized) {
      return 0n;
    }
    if (!/^[-+]?\d+$/.test(normalized)) {
      throw new TypeError("String values must represent integers");
    }
    return BigInt(normalized);
  }

  if (typeof value === "object" && value !== null) {
    if (typeof value.valueOf === "function" && value.valueOf() !== value) {
      return toBigIntSafe(value.valueOf());
    }
    if (typeof value.toString === "function") {
      const stringValue = value.toString();
      if (stringValue && stringValue !== "[object Object]") {
        return toBigIntSafe(stringValue);
      }
    }
  }

  throw new TypeError("Value cannot be converted to BigInt");
}

function normalizeSymbol(symbol) {
  return typeof symbol === "string" && symbol ? symbol.toUpperCase() : "";
}

function resolveOfflineFixturePath() {
  const configured = process.env.KEETA_OFFLINE_FIXTURE;
  if (!configured) {
    return DEFAULT_OFFLINE_FIXTURE_PATH;
  }
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

async function readOfflineFixture() {
  const fixturePath = resolveOfflineFixturePath();
  if (
    cachedOfflineFixture &&
    cachedOfflineFixturePath &&
    cachedOfflineFixturePath === fixturePath
  ) {
    return cachedOfflineFixture;
  }
  try {
    const contents = await fs.readFile(fixturePath, "utf8");
    const parsed = JSON.parse(contents);
    cachedOfflineFixture = parsed;
    cachedOfflineFixturePath = fixturePath;
    return parsed;
  } catch (error) {
    console.warn("Failed to load offline Keeta fixture", error);
    cachedOfflineFixture = null;
    cachedOfflineFixturePath = null;
    return null;
  }
}

function resolveAnchorsFixturePath() {
  const configured = process.env.KEETA_ANCHORS_FIXTURE;
  if (!configured) {
    return DEFAULT_ANCHORS_FIXTURE_PATH;
  }
  if (path.isAbsolute(configured)) {
    return configured;
  }
  return path.resolve(process.cwd(), configured);
}

async function readAnchorsFixture() {
  const fixturePath = resolveAnchorsFixturePath();
  if (
    cachedAnchorsFixture &&
    cachedAnchorsFixturePath &&
    cachedAnchorsFixturePath === fixturePath
  ) {
    return cachedAnchorsFixture;
  }

  try {
    const contents = await fs.readFile(fixturePath, "utf8");
    const parsed = JSON.parse(contents);
    cachedAnchorsFixture = parsed;
    cachedAnchorsFixturePath = fixturePath;
    return parsed;
  } catch (error) {
    console.warn("Failed to load anchor fixture", error);
    cachedAnchorsFixture = { anchors: [] };
    cachedAnchorsFixturePath = fixturePath;
    return cachedAnchorsFixture;
  }
}

function applyOfflineOverrides(baseContext, overrides = {}) {
  const context = deepClone(baseContext) || {};
  context.timestamp = new Date().toISOString();

  if (!context.pool) {
    context.pool = {};
  }
  if (overrides.poolAccount) {
    context.pool.address = overrides.poolAccount;
  }

  if (!context.lpToken) {
    context.lpToken = {};
  }
  if (overrides.lpTokenAccount) {
    context.lpToken.address = overrides.lpTokenAccount;
  }

  const tokenOverrides = normalizeTokenOverrides(overrides.tokenAddresses || {});
  const seenSymbols = new Set();

  context.tokens = Array.isArray(context.tokens) ? context.tokens : [];
  context.tokens = context.tokens.map((token) => {
    const symbolKey = normalizeSymbol(token.symbol);
    seenSymbols.add(symbolKey);
    if (symbolKey && tokenOverrides[symbolKey]) {
      return {
        ...token,
        address: tokenOverrides[symbolKey],
        requiresConfiguration: false,
      };
    }
    return token;
  });

  for (const [rawSymbol, address] of Object.entries(tokenOverrides)) {
    if (!rawSymbol || !address) {
      continue;
    }
    const symbolKey = normalizeSymbol(rawSymbol);
    if (seenSymbols.has(symbolKey)) {
      continue;
    }
    const symbol = rawSymbol.toString();
    const token = {
      symbol,
      address,
      decimals: 0,
      info: {},
      metadata: {},
      reserveRaw: "0",
      reserveFormatted: "0",
      requiresConfiguration: false,
    };
    context.tokens.push(token);
    seenSymbols.add(symbolKey);
  }

  context.reserves = context.tokens.reduce((acc, token) => {
    if (token && token.symbol) {
      acc[token.symbol] = token;
    }
    return acc;
  }, {});

  const missing = context.tokens
    .filter((token) => token && token.requiresConfiguration)
    .map((token) => token.symbol)
    .filter(Boolean);

  context.missingTokenSymbols = missing;
  context.requiresTokenConfiguration = missing.length > 0;
  context.message =
    context.message || "Pool state fetched from offline fixture";

  return context;
}

async function loadOfflinePoolContext(overrides = {}) {
  if (!USE_OFFLINE_FIXTURE) {
    return null;
  }
  const fixture = await readOfflineFixture();
  if (!fixture) {
    return null;
  }
  return applyOfflineOverrides(fixture, overrides);
}

function extractAnchorId(anchor) {
  if (!anchor) {
    return "";
  }

  const raw = anchor.raw || anchor;
  const candidates = [
    raw.anchorId,
    raw.anchor_id,
    raw.id,
    raw.address,
    raw.anchorAddress,
    raw.anchor_address,
    raw.identifier,
    raw.publicKey,
    raw.public_key,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  try {
    if (raw.account?.publicKeyString?.get) {
      const value = raw.account.publicKeyString.get();
      if (typeof value === "string" && value.trim()) {
        return value.trim();
      }
    }
  } catch (error) {
    /* ignore */
  }

  return "";
}

function normalizeAnchorTokens(anchor) {
  if (!anchor) {
    return [];
  }

  const raw = anchor.raw || anchor;
  const tokenCandidates = [
    raw.tokens,
    raw.pair,
    raw.assets,
    raw.symbols,
    raw.pairTokens,
    raw.tokenPair,
    raw.tokensList,
  ];

  for (const candidate of tokenCandidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      const normalized = candidate
        .map((value) => normalizeSymbol(value))
        .filter(Boolean);
      if (normalized.length >= 2) {
        return normalized.slice(0, 2);
      }
    }
  }

  const fallback = [];
  const baseCandidate =
    raw.baseSymbol || raw.base || raw.tokenA || raw.tokenIn || raw.from;
  const quoteCandidate =
    raw.quoteSymbol || raw.quote || raw.tokenB || raw.tokenOut || raw.to;

  if (baseCandidate) {
    fallback.push(normalizeSymbol(baseCandidate));
  }
  if (quoteCandidate) {
    fallback.push(normalizeSymbol(quoteCandidate));
  }

  return fallback.filter(Boolean).slice(0, 2);
}

function normalizeAnchorRate(value) {
  if (value === undefined || value === null) {
    return null;
  }

  if (Array.isArray(value)) {
    const [rawNumerator, rawDenominator] = value;
    try {
      const numerator = toBigIntSafe(rawNumerator ?? 0);
      const denominator = toBigIntSafe(rawDenominator ?? 1);
      if (denominator === 0n) {
        return null;
      }
      return { numerator, denominator };
    } catch (error) {
      return null;
    }
  }

  if (typeof value === "object") {
    const numeratorCandidate =
      value.numerator ??
      value.num ??
      value.value ??
      value.rate ??
      value.amountOut ??
      value.amount ??
      value.price ??
      (Array.isArray(value) ? value[0] : undefined);
    const denominatorCandidate =
      value.denominator ??
      value.den ??
      value.scale ??
      value.amountIn ??
      value.input ??
      value.base ??
      (Array.isArray(value) ? value[1] : undefined);

    try {
      const numerator = toBigIntSafe(numeratorCandidate ?? 0);
      const denominator = toBigIntSafe(denominatorCandidate ?? 1);
      if (denominator === 0n) {
        return null;
      }
      return { numerator, denominator };
    } catch (error) {
      return null;
    }
  }

  try {
    const numerator = toBigIntSafe(value);
    return { numerator, denominator: 1n };
  } catch (error) {
    return null;
  }
}

function normalizeAnchorQuotes(quotes) {
  const routes = new Map();
  if (!quotes || typeof quotes !== "object") {
    return routes;
  }

  for (const [tokenInRaw, outbound] of Object.entries(quotes)) {
    const tokenIn = normalizeSymbol(tokenInRaw);
    if (!tokenIn) {
      continue;
    }

    const outboundMap = new Map();
    if (outbound && typeof outbound === "object") {
      for (const [tokenOutRaw, rateRaw] of Object.entries(outbound)) {
        const tokenOut = normalizeSymbol(tokenOutRaw);
        if (!tokenOut) {
          continue;
        }
        const rate = normalizeAnchorRate(rateRaw);
        if (!rate) {
          continue;
        }
        outboundMap.set(tokenOut, rate);
      }
    }

    if (outboundMap.size > 0) {
      routes.set(tokenIn, outboundMap);
    }
  }

  return routes;
}

function normalizeAnchor(anchor) {
  if (!anchor) {
    return null;
  }

  if (
    anchor &&
    anchor.anchorId &&
    Array.isArray(anchor.tokens) &&
    anchor.quotes instanceof Map
  ) {
    return anchor;
  }

  const raw = anchor.raw || anchor;
  const anchorId = extractAnchorId(raw);
  const tokens = normalizeAnchorTokens(raw);
  if (tokens.length < 2) {
    return null;
  }

  const quotes = normalizeAnchorQuotes(
    raw.quotes || raw.rates || raw.pricing || raw.priceMap || raw.routes
  );

  if (quotes.size === 0) {
    const fallbackRate = normalizeAnchorRate(
      raw.price || raw.rate || raw.quote || raw.amountOutPerUnit
    );
    if (fallbackRate) {
      const [tokenA, tokenB] = tokens;
      const forwardMap = new Map();
      forwardMap.set(tokenB, fallbackRate);
      quotes.set(tokenA, forwardMap);

      if (fallbackRate.numerator !== 0n) {
        const inverseRate = {
          numerator: fallbackRate.denominator,
          denominator: fallbackRate.numerator,
        };
        const reverseMap = new Map();
        reverseMap.set(tokenA, inverseRate);
        quotes.set(tokenB, reverseMap);
      }
    }
  }

  const feeBpsValue = raw.feeBps ?? raw.fee_bps ?? raw.fee ?? 0;
  const feeBps = Number.isFinite(Number(feeBpsValue))
    ? Number(feeBpsValue)
    : 0;

  return {
    anchorId: anchorId || `${tokens[0]}_${tokens[1]}`,
    tokens,
    feeBps,
    quotes,
    raw,
  };
}

async function listAnchors(client) {
  void client;
  const fixture = await readAnchorsFixture();
  const sourceAnchors = Array.isArray(fixture?.anchors)
    ? fixture.anchors
    : Array.isArray(fixture)
    ? fixture
    : [];

  return sourceAnchors
    .map((anchor) => {
      const normalized = normalizeAnchor(anchor);
      if (!normalized) return null;
      return {
        ...normalized,
        id: normalized.anchorId,
        pair: normalized.tokens,
      };
    })
    .filter(Boolean);
}

async function getAnchorQuote(
  client,
  anchor,
  tokenIn,
  amountIn,
  tokenOut = null
) {
  void client;
  if (amountIn === undefined || amountIn === null) {
    return null;
  }

  let amount;
  try {
    amount = toBigIntSafe(amountIn);
  } catch (error) {
    return null;
  }

  if (amount < 0n) {
    return null;
  }

  const normalizedAnchor = normalizeAnchor(anchor);
  if (!normalizedAnchor) {
    return null;
  }

  const tokenInSymbol = normalizeSymbol(tokenIn);
  if (!tokenInSymbol) {
    return null;
  }

  const outbound = normalizedAnchor.quotes.get(tokenInSymbol);
  if (!outbound || outbound.size === 0) {
    return null;
  }

  let desiredOutSymbol = tokenOut ? normalizeSymbol(tokenOut) : "";
  let rate = desiredOutSymbol ? outbound.get(desiredOutSymbol) : null;

  if (!rate && !desiredOutSymbol) {
    if (outbound.size === 1) {
      const [onlySymbol, onlyRate] = outbound.entries().next().value;
      desiredOutSymbol = onlySymbol;
      rate = onlyRate;
    } else {
      for (const symbol of normalizedAnchor.tokens) {
        if (symbol && symbol !== tokenInSymbol) {
          const candidate = outbound.get(symbol);
          if (candidate) {
            desiredOutSymbol = symbol;
            rate = candidate;
            break;
          }
        }
      }
    }
  }

  if (!rate) {
    return null;
  }

  if (rate.denominator === 0n) {
    return null;
  }

  const amountOut = (amount * rate.numerator) / rate.denominator;
  if (amountOut < 0n) {
    return null;
  }

  return {
    anchorId: normalizedAnchor.anchorId,
    tokenIn: tokenInSymbol,
    tokenOut: desiredOutSymbol || null,
    amountIn: amount.toString(),
    amountOut: amountOut.toString(),
    feeBps: normalizedAnchor.feeBps,
  };
}

async function routeAnchors(client, tokenIn, tokenOut, amountIn) {
  const amount = toBigIntSafe(amountIn);
  const tokenInSymbol = normalizeSymbol(tokenIn);
  const tokenOutSymbol = normalizeSymbol(tokenOut);

  const anchors = await listAnchors(client);
  let bestQuote = null;

  for (const anchor of anchors) {
    if (!anchor || !anchor.tokens) {
      continue;
    }

    if (tokenInSymbol && !anchor.tokens.includes(tokenInSymbol)) {
      continue;
    }
    if (tokenOutSymbol && !anchor.tokens.includes(tokenOutSymbol)) {
      continue;
    }

    const quote = await getAnchorQuote(
      client,
      anchor,
      tokenInSymbol,
      amount,
      tokenOutSymbol
    );

    if (!quote || !quote.amountOut) {
      continue;
    }

    if (!bestQuote) {
      bestQuote = quote;
      continue;
    }

    try {
      const current = toBigIntSafe(quote.amountOut);
      const previous = toBigIntSafe(bestQuote.amountOut);
      if (current > previous) {
        bestQuote = quote;
      }
    } catch (error) {
      /* ignore comparison errors */
    }
  }

  return bestQuote;
}

function getEnvTokenAddress(symbol) {
  if (!symbol) return null;
  const envKey = `KEETA_TOKEN_${symbol.toUpperCase()}`;
  if (process.env[envKey]) {
    return process.env[envKey];
  }
  const staticKey = symbol.toUpperCase();
  if (Object.prototype.hasOwnProperty.call(STATIC_TOKEN_ADDRESSES, staticKey)) {
    return STATIC_TOKEN_ADDRESSES[staticKey];
  }
  return null;
}

function resolveConfiguredDecimals(symbol, decimals) {
  const key = typeof symbol === "string" ? symbol.toUpperCase() : "";
  if (key && Object.prototype.hasOwnProperty.call(TOKEN_DECIMAL_OVERRIDES, key)) {
    const override = Number(TOKEN_DECIMAL_OVERRIDES[key]);
    if (Number.isFinite(override) && override >= 0) {
      return override;
    }
  }
  const numeric = Number(decimals);
  if (Number.isFinite(numeric) && numeric >= 0) {
    return numeric;
  }
  return 0;
}

function decodeMetadata(metadata) {
  if (!metadata) return {};
  if (typeof metadata === "object" && metadata !== null) {
    return metadata;
  }

  const value = String(metadata);
  if (!value.trim()) {
    return {};
  }

  const attempts = [
    () => Buffer.from(value, "base64").toString("utf8"),
    () => value,
  ];

  for (const decode of attempts) {
    try {
      const candidate = decode();
      if (!candidate) {
        continue;
      }
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch (error) {
      /* continue to next strategy */
    }
  }

  return {};
}

function extractAccountAddress(value, seen = new Set()) {
  if (!value) {
    return null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
  }
  if (typeof value !== "object") {
    return null;
  }
  if (seen.has(value)) {
    return null;
  }
  seen.add(value);

  if (typeof value.publicKeyString === "string") {
    const trimmed = value.publicKeyString.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  if (value.publicKeyString && typeof value.publicKeyString.get === "function") {
    try {
      const resolved = value.publicKeyString.get();
      if (typeof resolved === "string" && resolved.trim()) {
        return resolved.trim();
      }
    } catch (err) {
      /* ignore invalid getter */
    }
  }

  const candidateKeys = [
    "address",
    "account",
    "accountAddress",
    "publicKey",
    "public_key",
    "publicKeyString",
    "tokenAccount",
    "token",
    "id",
    "value",
  ];

  for (const key of candidateKeys) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      continue;
    }
    const nested = value[key];
    if (!nested) {
      continue;
    }
    const resolved = extractAccountAddress(nested, seen);
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

function accountToString(account) {
  if (!account) {
    return "";
  }
  try {
    if (typeof account.publicKeyString?.get === "function") {
      return account.publicKeyString.get();
    }
    if (typeof account.publicKeyString === "string") {
      return account.publicKeyString;
    }
  } catch (error) {
    /* fall through */
  }
  return String(account ?? "");
}

function decodeFactoryMetadataFromInfo(accountInfo) {
  if (!accountInfo || !accountInfo.info) {
    return null;
  }
  const metadata = decodeMetadata(accountInfo.info.metadata);
  if (!metadata || typeof metadata !== "object") {
    return null;
  }
  return {
    version: Number(metadata.version ?? 1),
    authority: metadata.authority ? String(metadata.authority) : "",
    defaultFeeBps: Number(metadata.defaultFeeBps ?? 0),
    allowCustomFees: Boolean(metadata.allowCustomFees ?? false),
    creationFee: metadata.creationFee ? String(metadata.creationFee) : "0",
    creationFeeToken: metadata.creationFeeToken
      ? String(metadata.creationFeeToken)
      : "",
    totalPools: Number(metadata.totalPools ?? 0),
    paused: Boolean(metadata.paused ?? false),
    latestEvent: metadata.latestEvent,
    raw: metadata,
  };
}

function decodePoolMetadataFromInfo(accountInfo) {
  if (!accountInfo || !accountInfo.info) {
    return {};
  }
  const metadata = decodeMetadata(accountInfo.info.metadata);
  if (!metadata || typeof metadata !== "object") {
    return {};
  }
  return {
    ...metadata,
    baseToken: metadata.baseToken ? String(metadata.baseToken) : metadata.tokenA,
    quoteToken: metadata.quoteToken
      ? String(metadata.quoteToken)
      : metadata.tokenB,
    feeBps: Number(metadata.feeBps ?? metadata.fee ?? 0),
    lpToken: metadata.lpToken ? String(metadata.lpToken) : metadata.lpMint,
  };
}

function normalizeFactoryPoolRegistry(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return [];
  }

  const candidates = Array.isArray(metadata.pools)
    ? metadata.pools
    : Array.isArray(metadata.registry?.pools)
    ? metadata.registry.pools
    : Array.isArray(metadata.registry)
    ? metadata.registry
    : [];

  const normalized = [];
  for (const entry of candidates) {
    if (!entry) continue;
    if (typeof entry === "string") {
      const poolAccount = entry.trim();
      if (poolAccount) {
        normalized.push({
          poolAccount,
          baseToken: "",
          quoteToken: "",
          raw: entry,
        });
      }
      continue;
    }

    const poolAccount =
      extractAccountAddress(entry.pool) ||
      extractAccountAddress(entry.poolAccount) ||
      extractAccountAddress(entry.address) ||
      extractAccountAddress(entry.id);
    if (!poolAccount) {
      continue;
    }

    normalized.push({
      poolAccount,
      baseToken:
        extractAccountAddress(entry.baseToken) ||
        extractAccountAddress(entry.baseMint) ||
        extractAccountAddress(entry.mintBase) ||
        "",
      quoteToken:
        extractAccountAddress(entry.quoteToken) ||
        extractAccountAddress(entry.quoteMint) ||
        extractAccountAddress(entry.mintQuote) ||
        "",
      lpToken:
        extractAccountAddress(entry.lpToken) ||
        extractAccountAddress(entry.lpMint) ||
        extractAccountAddress(entry.lp_token) ||
        "",
      vaultBase:
        extractAccountAddress(entry.vaultBase) ||
        extractAccountAddress(entry.vault_base) ||
        extractAccountAddress(entry.baseVault) ||
        "",
      vaultQuote:
        extractAccountAddress(entry.vaultQuote) ||
        extractAccountAddress(entry.vault_quote) ||
        extractAccountAddress(entry.quoteVault) ||
        "",
      feeVaultBase:
        extractAccountAddress(entry.feeVaultBase) ||
        extractAccountAddress(entry.fee_vault_base) ||
        "",
      feeVaultQuote:
        extractAccountAddress(entry.feeVaultQuote) ||
        extractAccountAddress(entry.fee_vault_quote) ||
        "",
      feeBps:
        typeof entry.feeBps === "number"
          ? entry.feeBps
          : Number.isFinite(Number(entry.feeTier ?? entry.fee_bps ?? entry.fee))
          ? Number(entry.feeTier ?? entry.fee_bps ?? entry.fee)
          : undefined,
      raw: entry,
    });
  }

  return normalized;
}

function findFactoryPoolEntry(factoryMetadata, poolAccountAddress) {
  if (!factoryMetadata || !poolAccountAddress) {
    return null;
  }
  const pools = normalizeFactoryPoolRegistry(factoryMetadata);
  if (!pools.length) {
    return null;
  }
  const target = poolAccountAddress.toLowerCase();
  for (const entry of pools) {
    if (entry.poolAccount && entry.poolAccount.toLowerCase() === target) {
      return entry;
    }
  }
  return null;
}

function encodeFactoryMetadata(config = {}) {
  return Buffer.from(JSON.stringify(config)).toString('base64');
}

function encodePoolMetadata(state = {}) {
  return Buffer.from(JSON.stringify(state)).toString('base64');
}

function appendEvent(state, event) {
  if (!state || typeof state !== "object") {
    return { latestEvent: event, events: [event] };
  }
  const events = Array.isArray(state.events)
    ? [...state.events]
    : [];
  if (state.latestEvent && typeof state.latestEvent === "object") {
    events.push(state.latestEvent);
  }
  if (event) {
    events.push(event);
  }
  return {
    ...state,
    latestEvent: event,
    events,
  };
}

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function canonicalTokenOrder(baseAccount, quoteAccount) {
  const baseKey = accountToString(baseAccount);
  const quoteKey = accountToString(quoteAccount);
  if (!baseKey || !quoteKey || baseKey <= quoteKey) {
    return {
      base: baseAccount,
      quote: quoteAccount,
      swapped: false,
      baseKey,
      quoteKey,
    };
  }
  return {
    base: quoteAccount,
    quote: baseAccount,
    swapped: true,
    baseKey: quoteKey,
    quoteKey: baseKey,
  };
}

function resolveMetadataTokenAccount(metadata, symbol, index) {
  if (!metadata) {
    return null;
  }

  const candidates = [];
  const normalizedSymbol = typeof symbol === "string" ? symbol.toUpperCase() : "";
  const variantSet = new Set();
  if (symbol !== undefined && symbol !== null) {
    variantSet.add(String(symbol));
  }
  if (normalizedSymbol) {
    variantSet.add(normalizedSymbol);
    variantSet.add(normalizedSymbol.toLowerCase());
  }
  const symbolVariants = Array.from(variantSet).filter(Boolean);

  const tokenLetter = index === 0 ? "A" : index === 1 ? "B" : null;
  if (tokenLetter) {
    const baseKey = `token${tokenLetter}`;
    const baseValue = metadata[baseKey];
    if (baseValue && typeof baseValue === "object" && !Array.isArray(baseValue)) {
      candidates.push(baseValue, baseValue.account, baseValue.address, baseValue.tokenAccount, baseValue.token);
    }
    const letterKeys = [`${baseKey}Account`, `${baseKey}Address`];
    for (const key of letterKeys) {
      if (!metadata[key]) {
        continue;
      }
      const value = metadata[key];
      if (value && typeof value === "object" && !Array.isArray(value)) {
        candidates.push(value.account, value.address, value.tokenAccount, value.token);
      }
      candidates.push(value);
    }
  }

  const nestedGroups = [metadata.tokenAccounts, metadata.tokenAddresses, metadata.tokens, metadata.assets];
  for (const group of nestedGroups) {
    if (!group) {
      continue;
    }
    if (Array.isArray(group)) {
      for (const entry of group) {
        if (!entry) continue;
        const entrySymbol =
          (entry.symbol || entry.ticker || entry.token || entry.name || "").toString();
        if (entrySymbol && entrySymbol.toUpperCase() === normalizedSymbol) {
          candidates.push(entry, entry.account, entry.address, entry.tokenAccount, entry.token);
        }
      }
      continue;
    }
    for (const variant of symbolVariants) {
      if (!variant || typeof group !== "object") continue;
      const key = String(variant);
      if (Object.prototype.hasOwnProperty.call(group, key)) {
        candidates.push(group[key]);
      }
      const upperVariant = key.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(group, upperVariant)) {
        candidates.push(group[upperVariant]);
      }
    }
  }

  for (const candidate of candidates) {
    const address = extractAccountAddress(candidate);
    if (address) {
      return address;
    }
  }

  return null;
}

function formatAmount(raw, decimals) {
  const bigRaw = BigInt(raw);
  const absValue = bigRaw < 0n ? -bigRaw : bigRaw;
  const base = 10n ** BigInt(decimals);
  const whole = absValue / base;
  const fraction = (absValue % base).toString().padStart(decimals, "0");
  const trimmedFraction = fraction.replace(/0+$/, "");
  const sign = bigRaw < 0n ? "-" : "";
  return trimmedFraction ? `${sign}${whole}.${trimmedFraction}` : `${sign}${whole}`;
}

function toRawAmount(amount, decimals) {
  if (amount === undefined || amount === null) return 0n;
  const normalized = String(amount).trim();
  if (!normalized) return 0n;
  const negative = normalized.startsWith("-");
  const value = negative ? normalized.slice(1) : normalized;
  if (!/^[0-9]*\.?[0-9]*$/.test(value)) {
    throw new Error(`Invalid numeric amount: ${amount}`);
  }
  const [whole, fraction = ""] = value.split(".");
  const truncatedFraction = fraction.slice(0, decimals);
  const paddedFraction = truncatedFraction.padEnd(decimals, "0");
  const combined = `${whole || "0"}${paddedFraction}`.replace(/^0+(?=\d)/, "");
  const raw = combined ? BigInt(combined) : 0n;
  return negative ? -raw : raw;
}

function sqrtBigInt(value) {
  if (value < 0n) {
    throw new Error("Cannot take square root of negative value");
  }
  if (value < 2n) {
    return value;
  }
  let x0 = value;
  let x1 = (value >> 1n) + 1n;
  while (x1 < x0) {
    x0 = x1;
    x1 = (value / x1 + x1) >> 1n;
  }
  return x0;
}

function calculateSwapQuote(amountIn, reserveIn, reserveOut, feeBps) {
  if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) {
    return {
      amountOut: 0n,
      feePaid: 0n,
      priceImpact: 0,
    };
  }
  const feeDenominator = 10000n;
  const feeNumerator = feeDenominator - BigInt(feeBps ?? 0);
  const amountInWithFee = amountIn * feeNumerator;
  const numerator = amountInWithFee * reserveOut;
  const denominator = reserveIn * feeDenominator + amountInWithFee;
  const amountOut = denominator === 0n ? 0n : numerator / denominator;
  const feePaid = amountIn - (amountInWithFee / feeDenominator);

  const spotPrice = Number(reserveOut) / Number(reserveIn);
  const newReserveIn = reserveIn + amountIn;
  const newReserveOut = reserveOut - amountOut;
  const newPrice =
    newReserveIn > 0n && newReserveOut > 0n
      ? Number(newReserveOut) / Number(newReserveIn)
      : spotPrice;
  const priceImpact =
    spotPrice === 0 ? 0 : Math.max(0, (spotPrice - newPrice) / spotPrice);

  return {
    amountOut,
    feePaid,
    priceImpact,
  };
}

function calculateLiquidityMint(amountA, amountB, reserveA, reserveB, totalSupply) {
  if (amountA <= 0n || amountB <= 0n) {
    return { minted: 0n, share: 0 };
  }
  if (reserveA === 0n || reserveB === 0n || totalSupply === 0n) {
    const geometricMean = sqrtBigInt(amountA * amountB);
    return { minted: geometricMean, share: 1 };
  }
  const liquidityA = (amountA * totalSupply) / reserveA;
  const liquidityB = (amountB * totalSupply) / reserveB;
  const minted = liquidityA < liquidityB ? liquidityA : liquidityB;
  const share = Number(minted) / Number(totalSupply);
  return { minted, share: Number.isFinite(share) ? share : 0 };
}

function calculateWithdrawal(lpAmount, reserveA, reserveB, totalSupply) {
  if (lpAmount <= 0n || totalSupply <= 0n) {
    return { amountA: 0n, amountB: 0n, share: 0 };
  }
  const amountA = (lpAmount * reserveA) / totalSupply;
  const amountB = (lpAmount * reserveB) / totalSupply;
  const share = Number(lpAmount) / Number(totalSupply);
  return {
    amountA,
    amountB,
    share: Number.isFinite(share) ? share : 0,
  };
}

async function createClient(options = {}) {
  const { seed, accountIndex = 0 } = options;
  let signer = null;
  if (seed) {
    signer = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
  }
  return KeetaNet.UserClient.fromNetwork(DEFAULT_NETWORK, signer);
}

async function resolveTokenAccount(
  client,
  symbol,
  fallback,
  overrideAddress
) {
  if (!symbol) return fallback || null;
  if (overrideAddress) {
    try {
      return KeetaNet.lib.Account.toAccount(overrideAddress);
    } catch (error) {
      throw new Error(`Invalid override address provided for ${symbol}`);
    }
  }
  if (symbol.toUpperCase() === "KTA") {
    return client.baseToken;
  }
  const envAddress = getEnvTokenAddress(symbol);
  if (envAddress) {
    return KeetaNet.lib.Account.toAccount(envAddress);
  }
  return fallback || null;
}

async function loadTokenDetails(client, account) {
  const accountInfo = await client.client.getAccountInfo(account);
  const metadata = decodeMetadata(accountInfo.info.metadata);
  const decimalsRaw = metadata.decimalPlaces ?? metadata.decimals ?? 0;
  const decimals = Number.isFinite(Number(decimalsRaw)) ? Number(decimalsRaw) : 0;
  const symbol =
    metadata.symbol || accountInfo.info.name || account.publicKeyString.get();
  return {
    address: account.publicKeyString.get(),
    account,
    info: accountInfo.info,
    decimals,
    metadata,
    symbol,
  };
}

function normalizeTokenOverrides(overrides = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(overrides)) {
    if (!key || !value) continue;
    normalized[key] = value;
    if (typeof key === "string") {
      normalized[key.toUpperCase()] = value;
    }
  }
  return normalized;
}

function resolvePoolMetadataTokenInfo(poolMetadata, index) {
  if (!poolMetadata) {
    return { metadata: {}, decimals: 0 };
  }

  const tokenKey = index === 0 ? "tokenA" : index === 1 ? "tokenB" : null;
  if (!tokenKey) {
    return { metadata: {}, decimals: 0 };
  }

  const entry = poolMetadata[tokenKey];
  const entryObject = entry && typeof entry === "object" && !Array.isArray(entry) ? entry : {};
  const decimalCandidates = [
    entryObject.decimalPlaces,
    entryObject.decimals,
    poolMetadata[`${tokenKey}Decimals`],
  ];

  let decimals = 0;
  for (const candidate of decimalCandidates) {
    if (candidate === undefined || candidate === null) {
      continue;
    }
    const numeric = Number(candidate);
    if (Number.isFinite(numeric) && numeric >= 0) {
      decimals = numeric;
      break;
    }
  }

  return { metadata: entryObject, decimals };
}

async function loadPoolContext(client, overrides = {}) {
  const poolAccountAddress =
    overrides.poolAccount ||
    overrides.poolIdentifier ||
    overrides.poolId ||
    DEFAULT_POOL_ACCOUNT;

  if (!poolAccountAddress) {
    throw new Error("A pool account identifier is required");
  }

  const pool = KeetaNet.lib.Account.toAccount(poolAccountAddress);
  const poolInfo = await client.client.getAccountInfo(pool);
  const poolMetadata = decodePoolMetadataFromInfo(poolInfo);

  const tokenSymbolsRaw = [
    poolMetadata.tokenA || poolMetadata.baseToken,
    poolMetadata.tokenB || poolMetadata.quoteToken,
  ];
  const tokenSymbols = tokenSymbolsRaw
    .map((symbol, index) => {
      if (symbol === undefined || symbol === null || symbol === "") {
        return `TOKEN${index + 1}`;
      }
      return String(symbol);
    })
    .filter(Boolean);

  const factoryAccountAddress =
    overrides.factoryAccount || DEFAULT_FACTORY_ACCOUNT || null;
  let factoryAccount = null;
  let factoryInfo = null;
  let factoryMetadata = null;
  let factoryRegistryEntry = null;

  if (factoryAccountAddress) {
    try {
      factoryAccount = KeetaNet.lib.Account.toAccount(factoryAccountAddress);
      factoryInfo = await client.client.getAccountInfo(factoryAccount);
      factoryMetadata = decodeFactoryMetadataFromInfo(factoryInfo);
      const metadataSource = factoryMetadata?.raw || factoryMetadata;
      factoryRegistryEntry = findFactoryPoolEntry(
        metadataSource,
        poolAccountAddress
      );
    } catch (factoryError) {
      console.warn("Failed to load factory metadata", factoryError);
    }
  }

  const lpCandidates = [
    overrides.lpTokenAccount,
    factoryRegistryEntry?.lpToken,
    poolMetadata.lpToken,
    poolMetadata.lpMint,
    DEFAULT_LP_TOKEN_ACCOUNT,
  ].filter(Boolean);

  let lpTokenAccount = null;
  let lpResolutionError = null;
  const seenLpCandidates = new Set();
  for (const candidate of lpCandidates) {
    const address = typeof candidate === "string" ? candidate : String(candidate);
    if (!address || seenLpCandidates.has(address)) continue;
    seenLpCandidates.add(address);
    try {
      lpTokenAccount = KeetaNet.lib.Account.toAccount(address);
      break;
    } catch (error) {
      lpResolutionError = error;
    }
  }

  if (!lpTokenAccount) {
    if (lpResolutionError) {
      throw new Error(
        `Unable to resolve LP token account for pool: ${lpResolutionError.message}`
      );
    }
    throw new Error("Unable to resolve LP token account for pool");
  }

  const lpTokenInfo = await loadTokenDetails(client, lpTokenAccount);
  const lpSupply = await client.client.getTokenSupply(lpTokenAccount);

  const normalizedOverrides = normalizeTokenOverrides(
    overrides.tokenAddresses || {}
  );
  const resolvedOverrides = { ...normalizedOverrides };

  if (factoryRegistryEntry) {
    const [baseSymbol, quoteSymbol] = tokenSymbols;
    if (factoryRegistryEntry.baseToken && baseSymbol) {
      const key = baseSymbol.toUpperCase();
      if (!resolvedOverrides[key]) {
        resolvedOverrides[key] = factoryRegistryEntry.baseToken;
      }
    }
    if (factoryRegistryEntry.quoteToken && quoteSymbol) {
      const key = quoteSymbol.toUpperCase();
      if (!resolvedOverrides[key]) {
        resolvedOverrides[key] = factoryRegistryEntry.quoteToken;
      }
    }
  }

  const baseTokenDetails = await loadTokenDetails(client, client.baseToken);
  const baseSymbol =
    baseTokenDetails.metadata.symbol || baseTokenDetails.info.name || "KTA";
  const baseToken = {
    symbol: baseSymbol,
    address: baseTokenDetails.address,
    decimals: resolveConfiguredDecimals(baseSymbol, baseTokenDetails.decimals),
    info: baseTokenDetails.info,
    metadata: baseTokenDetails.metadata,
  };

  const tokenDetails = [];
  const missingTokenSymbols = [];
  const registryTokens = [
    factoryRegistryEntry?.baseToken || null,
    factoryRegistryEntry?.quoteToken || null,
  ];

  for (const [index, rawSymbol] of tokenSymbols.entries()) {
    const symbol = rawSymbol || `TOKEN${index + 1}`;

    const metadataAddress = resolveMetadataTokenAccount(
      poolMetadata,
      symbol,
      index
    );
    const registryAddress = registryTokens[index];
    const overrideKey = symbol.toUpperCase();
    const overrideAddress =
      resolvedOverrides[overrideKey] || resolvedOverrides[symbol];

    const candidateAddresses = [
      overrideAddress,
      registryAddress,
      metadataAddress,
    ].filter(Boolean);

    let fallbackAccount = null;
    for (const candidate of candidateAddresses) {
      try {
        fallbackAccount = KeetaNet.lib.Account.toAccount(candidate);
        break;
      } catch (error) {
        console.warn(`Invalid token address candidate for ${symbol}`, error);
      }
    }

    const tokenMetadataInfo = resolvePoolMetadataTokenInfo(poolMetadata, index);
    const tokenAccount = await resolveTokenAccount(
      client,
      symbol,
      fallbackAccount,
      overrideAddress
    );

    if (!tokenAccount) {
      missingTokenSymbols.push(symbol);
      tokenDetails.push({
        symbol,
        address:
          overrideAddress || registryAddress || metadataAddress || "",
        decimals: resolveConfiguredDecimals(symbol, tokenMetadataInfo.decimals),
        info: null,
        metadata: tokenMetadataInfo.metadata || {},
        requiresConfiguration: true,
      });
      continue;
    }

    const details = await loadTokenDetails(client, tokenAccount);
    details.symbol = symbol;
    details.decimals = resolveConfiguredDecimals(symbol, details.decimals);
    tokenDetails.push(details);
  }

  const balances = await client.client.getAllBalances(pool);
  const reserveMap = new Map();
  for (const { token, balance } of balances) {
    reserveMap.set(token.publicKeyString.get(), balance);
  }

  const formattedTokens = tokenDetails.map((token) => {
    const address = token.address || "";
    const decimals = resolveConfiguredDecimals(token.symbol, token.decimals);
    const raw = address ? reserveMap.get(address) || 0n : 0n;
    return {
      symbol: token.symbol,
      address,
      decimals,
      info: token.info,
      metadata: token.metadata,
      reserveRaw: raw.toString(),
      reserveFormatted: formatAmount(raw, decimals),
      requiresConfiguration: Boolean(token.requiresConfiguration),
    };
  });

  const metadataVaultBase =
    extractAccountAddress(poolMetadata.vaultBase) ||
    extractAccountAddress(poolMetadata.baseVault) ||
    extractAccountAddress(poolMetadata.vaults?.base);
  const metadataVaultQuote =
    extractAccountAddress(poolMetadata.vaultQuote) ||
    extractAccountAddress(poolMetadata.quoteVault) ||
    extractAccountAddress(poolMetadata.vaults?.quote);
  const metadataFeeVaultBase =
    extractAccountAddress(poolMetadata.feeVaultBase) ||
    extractAccountAddress(poolMetadata.fee_vault_base) ||
    extractAccountAddress(poolMetadata.vaults?.feeBase);
  const metadataFeeVaultQuote =
    extractAccountAddress(poolMetadata.feeVaultQuote) ||
    extractAccountAddress(poolMetadata.fee_vault_quote) ||
    extractAccountAddress(poolMetadata.vaults?.feeQuote);

  const vaults = {
    base: factoryRegistryEntry?.vaultBase || metadataVaultBase || "",
    quote: factoryRegistryEntry?.vaultQuote || metadataVaultQuote || "",
    feeBase:
      factoryRegistryEntry?.feeVaultBase || metadataFeeVaultBase || "",
    feeQuote:
      factoryRegistryEntry?.feeVaultQuote || metadataFeeVaultQuote || "",
  };

  const factoryContext = factoryAccount
    ? {
        address: accountToString(factoryAccount),
        metadata: factoryMetadata?.raw || factoryMetadata || {},
        config: factoryMetadata
          ? {
              version: factoryMetadata.version,
              authority: factoryMetadata.authority,
              defaultFeeBps: factoryMetadata.defaultFeeBps,
              allowCustomFees: factoryMetadata.allowCustomFees,
              creationFee: factoryMetadata.creationFee,
              creationFeeToken: factoryMetadata.creationFeeToken,
              totalPools: factoryMetadata.totalPools,
              paused: factoryMetadata.paused,
              latestEvent: factoryMetadata.latestEvent,
            }
          : null,
      }
    : null;

  const poolFeeBps =
    typeof poolMetadata.feeBps === "number" && !Number.isNaN(poolMetadata.feeBps)
      ? poolMetadata.feeBps
      : typeof factoryRegistryEntry?.feeBps === "number"
      ? factoryRegistryEntry.feeBps
      : factoryMetadata &&
        typeof factoryMetadata.defaultFeeBps === "number" &&
        !Number.isNaN(factoryMetadata.defaultFeeBps)
      ? factoryMetadata.defaultFeeBps
      : 30;

  const poolRegistry = factoryRegistryEntry
    ? {
        ...factoryRegistryEntry,
        raw: factoryRegistryEntry.raw || null,
      }
    : null;

  return {
    network: DEFAULT_NETWORK,
    executeTransactions: EXECUTE_TRANSACTIONS,
    pool: {
      address: poolAccountAddress,
      name: poolInfo.info.name,
      description: poolInfo.info.description,
      metadata: poolMetadata,
      feeBps: poolFeeBps,
      registry: poolRegistry,
    },
    tokens: formattedTokens,
    reserves: formattedTokens.reduce((acc, token) => {
      acc[token.symbol] = token;
      return acc;
    }, {}),
    lpToken: {
      symbol: lpTokenInfo.metadata.symbol || lpTokenInfo.info.name,
      address: lpTokenInfo.address,
      decimals: lpTokenInfo.decimals,
      info: lpTokenInfo.info,
      metadata: lpTokenInfo.metadata,
      supplyRaw: lpSupply.toString(),
      supplyFormatted: formatAmount(lpSupply, lpTokenInfo.decimals),
    },
    baseToken,
    vaults,
    factory: factoryContext,
    timestamp: new Date().toISOString(),
    requiresTokenConfiguration: missingTokenSymbols.length > 0,
    missingTokenSymbols,
  };
}
/**
 * Create a new Keeta wallet from a random seed
 */
async function createWallet() {
  const seedBuffer = KeetaNet.lib.Account.generateRandomSeed();
  const seed = Buffer.from(seedBuffer).toString('hex');
  const account = KeetaNet.lib.Account.fromSeed(seed, 0);
  return {
    seed,
    address: account.publicKeyString.get(),
    account,
  };
}

/**
 * Import an existing wallet from a provided seed (DNA)
 */
async function importWallet(seed, accountIndex = 0) {
  const account = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
  return {
    seed,
    address: account.publicKeyString.get(),
    account,
  };
}

/**
 * Get KTA balance for an address
 */
async function getBalance(client, address) {
  try {
    const account = KeetaNet.lib.Account.toAccount(address);
    const balance = await client.client.getTokenBalance(account);
    return balance.toString(); // raw string; can format as needed
  } catch (err) {
    console.error("Failed to fetch balance:", err);
    return "0";
  }
}

function isValidAddress(address) {
  if (typeof address !== "string") {
    return false;
  }

  const normalized = address.trim();
  if (!normalized) {
    return false;
  }

  try {
    const account = KeetaNet.lib.Account.toAccount(normalized);
    return Boolean(account?.publicKeyString?.get?.());
  } catch (error) {
    void error;
    return false;
  }
}

async function submitTx(client, signedTx) {
  if (!signedTx) {
    throw new Error("Signed transaction required");
  }

  if (typeof signedTx.submit === "function") {
    const result = await signedTx.submit();
    if (typeof result === "string") return result;
    if (result?.txId || result?.transactionId || result?.id) {
      return result.txId || result.transactionId || result.id;
    }
    return JSON.stringify(result ?? {});
  }

  if (client?.amm?.submitTransaction) {
    const result = await client.amm.submitTransaction(signedTx);
    if (typeof result === "string") return result;
    if (result?.txId || result?.transactionId || result?.id) {
      return result.txId || result.transactionId || result.id;
    }
    return JSON.stringify(result ?? {});
  }

  if (client?.client?.submitTransaction) {
    const result = await client.client.submitTransaction(signedTx);
    if (typeof result === "string") return result;
    if (result?.txId || result?.transactionId || result?.id) {
      return result.txId || result.transactionId || result.id;
    }
    return JSON.stringify(result ?? {});
  }

  throw new Error("No submit handler available for transaction");
}

async function buildAnchorSwapTx(
  client,
  anchor,
  account,
  tokenIn,
  amountIn,
  slippageBps = 50
) {
  if (!anchor?.address) throw new Error("Anchor address required");
  const anchorAddr = anchor.address;

  if (client?.amm?.buildSwapTxForPool) {
    return await client.amm.buildSwapTxForPool({
      pool: anchorAddr,
      owner: account,
      tokenIn,
      amountIn,
      slippageBps,
    });
  }

  if (client?.pools?.buildSwapTx) {
    return await client.pools.buildSwapTx({
      pool: anchorAddr,
      owner: account,
      tokenIn,
      amountIn,
      slippageBps,
    });
  }

  throw new Error("Swap TX builder not found on client.");
}

export {
  DEFAULT_NETWORK,
  DEFAULT_POOL_ACCOUNT,
  DEFAULT_LP_TOKEN_ACCOUNT,
  DEFAULT_FACTORY_ACCOUNT,
  EXECUTE_TRANSACTIONS,
  parseJsonBody,
  toBigIntSafe,
  normalizeNetworkName,
  calculateLiquidityMint,
  calculateSwapQuote,
  calculateWithdrawal,
  createClient,
  loadOfflinePoolContext,
  listAnchors,
  getAnchorQuote,
  routeAnchors,
  decodeMetadata,
  decodeFactoryMetadataFromInfo,
  decodePoolMetadataFromInfo,
  normalizeFactoryPoolRegistry,
  findFactoryPoolEntry,
  accountToString,
  encodeFactoryMetadata,
  encodePoolMetadata,
  appendEvent,
  nowSeconds,
  canonicalTokenOrder,
  formatAmount,
  loadPoolContext,
  loadTokenDetails,
  toRawAmount,
  createWallet,
  importWallet,
  getBalance,
  isValidAddress,
  submitTx,
  buildAnchorSwapTx,
};
