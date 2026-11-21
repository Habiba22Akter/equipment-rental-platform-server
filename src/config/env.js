import "dotenv/config";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export const env = {
  dbUrl: required("DB_URL"),
  dbName: process.env.DB_NAME?.trim() || "equipment-rental-platform",
  port: Number(process.env.PORT) || 5001,
  clientOrigins: (process.env.CLIENT_ORIGIN || "http://localhost:3000")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  // Optional shared secret for write requests made by the Next.js server.
  internalApiKey: process.env.INTERNAL_API_KEY?.trim() || "",
};
