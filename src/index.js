import { app } from "./app.js";
import { closeDatabase } from "./config/database.js";
import { env } from "./config/env.js";

async function startServer() {
  const server = app.listen(env.port, () => {
    console.log(`Server is running on port ${env.port}`);
  });

  const shutdown = () => {
    server.close(async () => {
      await closeDatabase();
      process.exit(0);
    });
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

startServer().catch((error) => {
  console.error("Failed to start server:", error.message);
  process.exit(1);
});
