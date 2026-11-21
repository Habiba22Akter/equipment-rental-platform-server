import { env } from "../config/env.js";

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Mutating routes are only called by the Next.js server, never by the browser.
 * When INTERNAL_API_KEY is configured, require it on write requests so the API
 * cannot be changed by anyone who finds the server URL.
 */
export function requireInternalKey(req, res, next) {
  if (!env.internalApiKey) return next();
  if (READ_METHODS.has(req.method)) return next();

  const provided = req.get("x-api-key");

  if (provided !== env.internalApiKey) {
    return res.status(401).json({
      success: false,
      error: { message: "Unauthorized request." },
    });
  }

  next();
}
