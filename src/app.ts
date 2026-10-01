import Fastify from "fastify";
import cors from "@fastify/cors";
import { registerHealthRoutes } from "./routes/health.js";
import { registerEnrollmentRoutes } from "./routes/enrollment.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerCallRoutes } from "./routes/calls.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: 65_536,
    requestTimeout: 10_000
  });
  app.register(cors, { origin: false });
  app.register(registerHealthRoutes);
  app.register(registerEnrollmentRoutes);
  app.register(registerEventRoutes);
  app.register(registerCallRoutes);
  return app;
}
