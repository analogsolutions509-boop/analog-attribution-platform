import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerEnrollmentRoutes } from "./routes/enrollment.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerCallRoutes } from "./routes/calls.js";
import { registerSecondRingRoutes } from "./routes/secondring.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerSupplierRoutes } from "./routes/suppliers.js";
import { registerPhonePoolRoutes } from "./routes/phone-pool.js";
import { registerCollectorRoutes } from "./routes/collector.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: config.EVENT_MAX_BODY_BYTES,
    requestTimeout: 10000
  });
  const allowedOrigins = config.CORS_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean);
  app.register(cors, { origin: allowedOrigins.length ? allowedOrigins : false, credentials: false });
  app.register(registerHealthRoutes);
  app.register(registerEnrollmentRoutes);
  app.register(registerEventRoutes);
  app.register(registerCallRoutes);
  app.register(registerSecondRingRoutes);
  app.register(registerLeadRoutes);
  app.register(registerSupplierRoutes);
  app.register(registerPhonePoolRoutes);
  app.register(registerCollectorRoutes);
  app.register(registerDashboardRoutes);
  return app;
}
