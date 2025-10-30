import { withCors } from "./utils/cors.js";
import { client } from "./utils/client.js";
import {
  parseJsonBody,
  toBigIntSafe,
  submitTx,
  buildAnchorSwapTx,
  routeAnchors,
  listAnchors,
} from "./utils/keeta.js";
import * as KeetaNet from "@keetanetwork/keetanet-client";

function jsonResponse(statusCode, body) {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

/**
 * POST /.netlify/functions/routeSwap
 *
 * Body:
 * {
 *   "accountIndex": 0,
 *   "tokenIn": "BTC",
 *   "tokenOut": "USD",
 *   "amountIn": "100000000",
 *   "slippageBps": 50
 * }
 *
 * The signing account seed must be provided via the ROUTE_SWAP_ACCOUNT_SEED
 * (or legacy ROUTESWAP_ACCOUNT_SEED) environment variable; it is never
 * accepted from the client request.
 *
 * Signing credentials are read from the ROUTE_SWAP_ACCOUNT_SEED (and optional
 * ROUTE_SWAP_ACCOUNT_INDEX) environment variables; client requests must not
 * include seed material.
 */
export const handler = withCors(async (event) => {
  if (event.httpMethod !== "POST") {
    return jsonResponse(405, { error: "Use POST" });
  }

  let body;
  try {
    body = parseJsonBody(event.body || "{}");
  } catch (error) {
    return jsonResponse(400, {
      error: error.message || "Invalid request body",
    });
  }

  const {
    accountIndex: requestAccountIndex,
    tokenIn,
    tokenOut,
    amountIn,
    slippageBps = 50,
  } = body;

  if (!tokenIn || !tokenOut || amountIn == null) {
    return jsonResponse(400, { error: "Missing required fields" });
  }

  let amountBI;
  try {
    amountBI = toBigIntSafe(amountIn);
  } catch (error) {
    return jsonResponse(400, {
      error:
        error.message || "amountIn must be an integer-compatible value",
    });
  }

  const c = await client;

  if (!KeetaNet?.lib?.Account?.fromSeed) {
    return jsonResponse(500, {
      error: "Keeta Account.fromSeed not found — update SDK reference",
    });
  }

  const configuredSeed =
    process.env.ROUTE_SWAP_ACCOUNT_SEED ??
    process.env.ROUTESWAP_ACCOUNT_SEED ??
    "";

  if (!configuredSeed) {
    console.error(
      "routeSwap misconfigured: missing ROUTE_SWAP_ACCOUNT_SEED environment variable"
    );
    return jsonResponse(500, {
      error: "Swap service unavailable",
    });
  }

  const configuredAccountIndex =
    process.env.ROUTE_SWAP_ACCOUNT_INDEX ??
    process.env.ROUTESWAP_ACCOUNT_INDEX;

  const parseAccountIndex = (value, source) => {
    if (value == null) {
      return undefined;
    }

    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed) || parsed < 0) {
      throw new Error(`${source} must be a non-negative integer`);
    }

    return parsed;
  };

  let resolvedAccountIndex = 0;
  let parsedEnvIndex;
  try {
    parsedEnvIndex = parseAccountIndex(
      configuredAccountIndex,
      "ROUTE_SWAP_ACCOUNT_INDEX"
    );
  } catch (error) {
    console.error("routeSwap misconfigured:", error);
    return jsonResponse(500, {
      error: "Swap service unavailable",
    });
  }

  try {
    const parsedBodyIndex = parseAccountIndex(
      requestAccountIndex,
      "accountIndex"
    );
    resolvedAccountIndex =
      parsedBodyIndex ?? parsedEnvIndex ?? resolvedAccountIndex;
  } catch (error) {
    return jsonResponse(400, {
      error: error.message || "Invalid accountIndex",
    });
  }

  let account;
  try {
    account = KeetaNet.lib.Account.fromSeed(
      configuredSeed,
      resolvedAccountIndex
    );
  } catch (error) {
    console.error("routeSwap failed to derive account:", error);
    return jsonResponse(500, {
      error: "Swap service unavailable",
    });
  }

  try {
    const best = await routeAnchors(c, tokenIn, tokenOut, amountBI);
    if (!best?.anchorId) {
      throw new Error("No valid anchor found for swap");
    }

    const anchors = await listAnchors(c);
    const anchor = anchors.find((a) => {
      const anchorKey = a?.anchorId ?? a?.id;
      return anchorKey === best.anchorId;
    });

    if (!anchor) {
      throw new Error("Anchor metadata not found");
    }

    const anchorAddress =
      anchor.address ||
      anchor.raw?.address ||
      anchor.raw?.pool ||
      anchor.raw?.poolAddress ||
      null;

    if (!anchorAddress) {
      throw new Error("Anchor address missing in metadata");
    }

    const unsignedTx = await buildAnchorSwapTx(
      c,
      { ...anchor, address: anchorAddress },
      account,
      tokenIn,
      amountBI,
      slippageBps
    );

    if (!unsignedTx?.signWith) {
      throw new Error("Unsigned transaction missing signWith method");
    }

    const signedTx = await unsignedTx.signWith(account);
    const txId = await submitTx(c, signedTx);

    return jsonResponse(200, {
      txId,
      anchor: anchor.anchorId ?? anchor.id ?? anchorAddress,
      route: {
        tokenIn,
        tokenOut,
        amountIn: amountBI.toString(),
        amountOut: best.amountOut?.toString?.() ?? String(best.amountOut ?? "0"),
        feeBps: best.feeBps ?? anchor.feeBps ?? 0,
      },
    });
  } catch (err) {
    console.error("routeSwap error:", err);
    return jsonResponse(500, {
      error: err.message || "Swap execution failed",
    });
  }
});
