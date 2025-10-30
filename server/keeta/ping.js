import { withCors } from "./utils/cors.js";
import { client } from "./utils/client.js";

export const handler = withCors(async () => {
  const t0 = Date.now();
  try {
    const c = await client;
    const t1 = Date.now();
    let height = null;
    try {
      if (c?.system?.getBlockHeight) {
        height = await c.system.getBlockHeight();
      }
    } catch (error) {
      console.warn("Failed to fetch block height", error);
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ok: true, connectMs: t1 - t0, height }),
    };
  } catch (error) {
    const t1 = Date.now();
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ok: false,
        connectMs: t1 - t0,
        error: error?.message || "Failed to initialize client",
      }),
    };
  }
});
