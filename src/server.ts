import "dotenv/config";
import { buildApp } from "./app.js";
import { config } from "./config.js";
import { closeDb } from "./db.js";
import { closeQueue } from "./queue.js";

await import("./migrate.js");

const app = buildApp();

try {
  await app.listen({ host: "0.0.0.0", port: config.PORT });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}

const shutdown = async () => {
  await app.close();
  await closeQueue();
  await closeDb();
  process.exit(0);
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
