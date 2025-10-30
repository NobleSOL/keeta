const DEFAULT_ALLOWED_ORIGINS = [
  "https://builder.io",
  "http://localhost:3000",
  "http://localhost:8888",
];

function parseAllowedOrigins(input) {
  if (!input) {
    return DEFAULT_ALLOWED_ORIGINS;
  }

  const entries = String(input)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return entries.length > 0 ? entries : DEFAULT_ALLOWED_ORIGINS;
}

export const allowedOrigins = parseAllowedOrigins(
  process.env.CORS_ALLOWED_ORIGINS
);

function normalizeOrigin(value) {
  if (!value) return "";
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

function pickAllowedOrigin(requestOrigin) {
  if (allowedOrigins.includes("*")) {
    return "*";
  }

  const normalizedRequest = normalizeOrigin(requestOrigin);
  for (const origin of allowedOrigins) {
    if (normalizeOrigin(origin) === normalizedRequest) {
      return origin;
    }
  }

  return allowedOrigins[0] || "";
}

export function withCors(handler) {
  return async (event, context) => {
    const origin =
      event?.headers?.origin || event?.headers?.Origin || event?.headers?.ORIGIN;
    const allowOrigin = pickAllowedOrigin(origin);

    if (event?.httpMethod === "OPTIONS") {
      return {
        statusCode: 204,
        headers: {
          "Access-Control-Allow-Origin": allowOrigin,
          Vary: "Origin",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
          "Access-Control-Max-Age": "86400",
        },
        body: "",
      };
    }

    const response = await handler(event, context);
    const responseHeaders = {
      "Access-Control-Allow-Origin": allowOrigin,
      Vary: "Origin",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      ...(response?.headers || {}),
    };

    const body =
      typeof response?.body === "string"
        ? response.body
        : response?.body
        ? JSON.stringify(response.body)
        : "";

    return {
      ...response,
      headers: responseHeaders,
      body,
    };
  };
}
