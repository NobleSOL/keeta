import { withCors } from "./utils/cors.js";
import { client } from "./utils/client.js";
import {
  parseJsonBody,
  toBigIntSafe,
  routeAnchors,
  listAnchors,
  getAnchorQuote,
} from "./utils/keeta.js";

export const handler = withCors(async (event) => {
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ error: "Use POST" }),
    };
  }

  let payload;
  try {
    payload = parseJsonBody(event.body || "{}");
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: error.message || "Invalid request body" }),
    };
  }

  const { tokenIn, tokenOut, amountIn } = payload;

  if (!tokenIn || !tokenOut) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "tokenIn and tokenOut required" }),
    };
  }
  if (amountIn == null) {
    return {
      statusCode: 400,
      body: JSON.stringify({ error: "amountIn required" }),
    };
  }

  let amountBI;
  try {
    amountBI = toBigIntSafe(amountIn);
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: error.message || "amountIn must be an integer-compatible value",
      }),
    };
  }

  try {
    const c = await client;
    const bestAnchor = await routeAnchors(c, tokenIn, tokenOut, amountBI);

    const anchors = await listAnchors(c);
    const allQuotes = await Promise.all(
      anchors.map((anchor) =>
        getAnchorQuote(c, anchor, tokenIn, amountBI, tokenOut)
      )
    );

    return {
      statusCode: 200,
      body: JSON.stringify({
        bestAnchor: bestAnchor || null,
        allQuotes: allQuotes.filter(Boolean),
      }),
    };
  } catch (err) {
    console.error("getQuote error:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Failed to get quote" }),
    };
  }
});
