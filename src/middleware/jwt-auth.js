import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

const JWKS = createRemoteJWKSet(new URL(env.jwtJwksUrl));

export async function requireJwt(req, res, next) {
  if (
    req.method === "GET" &&
    (req.path.startsWith("/equipments") || req.path.startsWith("/reviews"))
  ) {
    return next();
  }

  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({
      success: false,
      error: { message: "Authentication required." },
    });
  }

  try {
    const token = authorization.slice("Bearer ".length).trim();
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.betterAuthUrl,
      audience: env.betterAuthUrl,
    });
    const role = typeof payload.role === "string" ? payload.role : "";
    const id = typeof payload.sub === "string"
      ? payload.sub
      : typeof payload.id === "string"
        ? payload.id
        : "";

    if (!id || !["Customer", "Owner", "Admin"].includes(role)) {
      return res.status(401).json({
        success: false,
        error: { message: "Invalid authentication token." },
      });
    }

    req.user = { id, role };
    return next();
  } catch {
    return res.status(401).json({
      success: false,
      error: { message: "Invalid or expired authentication token." },
    });
  }
}
