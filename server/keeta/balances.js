import { withCors } from "./utils/cors.js";
import { client } from "./utils/client.js";
import { parseJsonBody, isValidAddress } from "./utils/keeta.js";
import * as KeetaNet from "@keetanetwork/keetanet-client";

export const handler = withCors(async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  let payload;
  try {
    payload = parseJsonBody(event.body || "{}");
  } catch (error) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error.message || "Invalid JSON body" }),
    };
  }

  const { address: addrIn, seed, accountIndex = 0 } = payload;
  const c = await client;

  let address = addrIn;
  if (!address && seed) {
    if (!KeetaNet?.lib?.Account?.fromSeed) {
      return {
        statusCode: 500,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "Account.fromSeed missing" }),
      };
    }
    try {
      const acct = KeetaNet.lib.Account.fromSeed(seed, accountIndex);
      address = acct?.address ?? acct?.getAddress?.() ?? acct?.publicKeyString?.get?.();
    } catch (error) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: error?.message || "Failed to derive address" }),
      };
    }
  }

  if (!address || !isValidAddress(address)) {
    return {
      statusCode: 400,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "Valid address or seed required" }),
    };
  }

  try {
    if (c?.accounts?.getBalances) {
      const res = await c.accounts.getBalances(address);
      const balances = (res?.balances || res || []).map((b) => ({
        token: b.token || b.mint || b.address,
        amount: b.amount?.toString?.() ?? String(b.amount ?? "0"),
        decimals: b.decimals ?? null,
        symbol: b.symbol ?? null,
      }));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, balances, raw: res }),
      };
    }

    if (c?.wallet?.getBalances) {
      const res = await c.wallet.getBalances({ address });
      const balances = (res || []).map((b) => ({
        token: b.token,
        amount: b.amount?.toString?.() ?? String(b.amount ?? "0"),
        decimals: b.decimals ?? null,
        symbol: b.symbol ?? null,
      }));
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, balances, raw: res }),
      };
    }

    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: "No balances method found on client." }),
    };
  } catch (error) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: error?.message || "Failed to fetch balances" }),
    };
  }
});
