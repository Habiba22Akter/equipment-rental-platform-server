import { createRemoteJWKSet, jwtVerify } from "jose";
import { env } from "../config/env.js";

const JWKS = createRemoteJWKSet(new URL(env.jwtJwksUrl));

// Verify the Better Auth JWT and attach the signed user id and role to req.user.
export async function verifyToken(req, res, next) {
  const authorization = req.get("authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return res.status(401).json({ success: false, error: { message: "Authentication required." } });
  }

  try {
    const token = authorization.slice("Bearer ".length).trim();
    const { payload } = await jwtVerify(token, JWKS, {
      issuer: env.betterAuthUrl,
      audience: env.betterAuthUrl,
    });
    const role = typeof payload.role === "string" ? payload.role : "";
    const id = typeof payload.sub === "string" ? payload.sub : typeof payload.id === "string" ? payload.id : "";

    if (!id || !["Customer", "Owner", "Admin"].includes(role)) {
      return res.status(401).json({ success: false, error: { message: "Invalid authentication token." } });
    }

    req.user = { id, role };
    return next();
  } catch {
    return res.status(401).json({ success: false, error: { message: "Invalid or expired authentication token." } });
  }
}

function allowRole(role, label) {
  return function roleMiddleware(req, res, next) {
    const checkRole = () => {
      if (req.user.role !== role) {
        return res.status(403).json({ success: false, error: { message: `${label} access required.` } });
      }
      return next();
    };
    return req.user ? checkRole() : verifyToken(req, res, checkRole);
  };
}

// This project calls the renter role "Customer".
export const verifyRenter = allowRole("Customer", "Renter");
export const verifyOwner = allowRole("Owner", "Owner");
export const verifyAdmin = allowRole("Admin", "Admin");
