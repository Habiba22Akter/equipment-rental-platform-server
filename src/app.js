import cors from "cors";
import express from "express";
import { env } from "./config/env.js";
import { errorHandler } from "./middleware/error-handler.js";
import { requireInternalKey } from "./middleware/internal-key.js";
import { notFoundHandler } from "./middleware/not-found.js";
import { apiRouter } from "./routes/index.js";
import { stripeWebhook } from "./routes/webhooks/stripe.js";

export const app = express();

app.use(cors({ origin: env.clientOrigins }));
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhook);
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ success: true, data: { name: "Equipment Rental Platform API" } });
});

app.get("/api/health", (_req, res) => {
  res.json({ success: true, data: { status: "ok" } });
});

app.use("/api", requireInternalKey);
app.use("/api", apiRouter);
app.use(notFoundHandler);
app.use(errorHandler);
