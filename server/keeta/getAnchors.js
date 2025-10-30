import { withCors } from "./utils/cors.js";
import { client } from "./utils/client.js";
import { listAnchors } from "./utils/keeta.js";

/**
 * GET /.netlify/functions/getAnchors
 * Optional query: ?pair=BTC/USD  (filters)
 */
export const handler = withCors(async (event) => {
  if (event.httpMethod !== "GET") {
    return {
      statusCode: 405,
      headers: { "Content-Type": "application/json", Allow: "GET,OPTIONS" },
      body: JSON.stringify({ error: "Use GET" }),
    };
  }

  let keetaClient;
  try {
    keetaClient = await client;
  } catch (error) {
    console.error("Failed to initialize Keeta client", error);
  }

  let anchors = [];
  try {
    anchors = await listAnchors(keetaClient);
  } catch (error) {
    console.error("Failed to list anchors", error);
    anchors = await listAnchors(undefined);
  }

  const pair = event.queryStringParameters?.pair;
  const filtered = (pair && pair.includes("/"))
    ? anchors.filter((anchor) => {
        const tokens = anchor.pair ?? anchor.tokens ?? [];
        return Array.isArray(tokens) && tokens.join("/") === pair;
      })
    : anchors;

  const normalized = filtered.map((anchor) => ({
    ...anchor,
    id: anchor.id ?? anchor.anchorId ?? anchor.raw?.anchorId ?? null,
    pair: anchor.pair ?? anchor.tokens ?? [],
  }));

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(normalized),
  };
});
