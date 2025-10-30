import { withCors } from "./utils/cors.js";
import {
  createClient,
  loadPoolContext,
  loadOfflinePoolContext,
} from "./utils/keeta.js";

function parseOverrides(event) {
  const overrides = {};

  const sources = [];
  if (event?.body) {
    try {
      const parsed = JSON.parse(event.body);
      if (parsed && typeof parsed === "object") {
        sources.push(parsed);
      }
    } catch (error) {
      console.warn("Failed to parse getpool body overrides", error);
    }
  }

  if (
    event?.queryStringParameters &&
    typeof event.queryStringParameters === "object"
  ) {
    sources.push(event.queryStringParameters);
  }

  for (const source of sources) {
    if (!source || typeof source !== "object") continue;

    const poolValue =
      source.poolAccount || source.poolId || source.poolIdentifier;
    if (typeof poolValue === "string" && poolValue.trim()) {
      overrides.poolAccount = poolValue.trim();
      overrides.poolIdentifier = poolValue.trim();
    }

    if (typeof source.factoryAccount === "string" && source.factoryAccount.trim()) {
      overrides.factoryAccount = source.factoryAccount.trim();
    }

    if (typeof source.lpTokenAccount === "string" && source.lpTokenAccount.trim()) {
      overrides.lpTokenAccount = source.lpTokenAccount.trim();
    }

    if (source.tokenAddresses && typeof source.tokenAddresses === "object") {
      overrides.tokenAddresses = {
        ...(overrides.tokenAddresses || {}),
        ...source.tokenAddresses,
      };
    }
  }

  return overrides;
}

async function getPoolHandler(event) {
  if (event.httpMethod && event.httpMethod.toUpperCase() === "OPTIONS") {
    return { statusCode: 204, body: "" };
  }

  let client;
  try {
    const overrides = parseOverrides(event);
    const offlineContext = await loadOfflinePoolContext(overrides);
    if (offlineContext) {
      return {
        statusCode: 200,
        body: JSON.stringify(offlineContext),
      };
    }

    client = await createClient();
    const context = await loadPoolContext(client, overrides);
    return {
      statusCode: 200,
      body: JSON.stringify({
        ...context,
        message: "Pool state fetched successfully",
      }),
    };
  } catch (error) {
    console.error("getpool error", error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || "Failed to load pool" }),
    };
  } finally {
    if (client && typeof client.destroy === "function") {
      try {
        await client.destroy();
      } catch (destroyErr) {
        console.warn("Failed to destroy Keeta client", destroyErr);
      }
    }
  }
}

export const handler = withCors(getPoolHandler);
