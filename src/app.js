import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireInternalKey } from "./middleware/internal-key.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { apiRouter } from "./routes/index.js";
import { stripeWebhook } from "./routes/webhooks/stripe.js";
import { completeExpiredBookings } from "./utils/complete-expired-bookings.js";

export const app = express();
export default app;

app.use(cors({ origin: env.clientOrigins }));
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ success: true, data: { name: "Equipment Rental Platform API" } });
});

app.get("/api/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

app.get("/api/cron/complete-bookings", async (req, res, next) => {
  if (!env.cronSecret || req.get("authorization") !== `Bearer ${env.cronSecret}`) {
    return res.status(401).json({ success: false, error: { message: "Unauthorized cron request." } });
  }
  try {
    return res.json({ success: true, data: await completeExpiredBookings() });
  } catch (error) {
    return next(error);
  }
});

app.use("/api", requireInternalKey);
app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
