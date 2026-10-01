import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { redis } from "../queue.js";

export async function registerHealthRoutes(app: FastifyInstance) {
  app.get("/health", async () => ({ status: "ok", service: "analog-attribution-api" }));
  app.get("/ready", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      await redis.ping();
      return { status: "ready" };
    } catch {
      return reply.code(503).send({ status: "not_ready" });
    }
  });
}
