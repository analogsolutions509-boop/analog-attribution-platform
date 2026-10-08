import Fastify from "fastify";
import cors from "@fastify/cors";
import formbody from "@fastify/formbody";
import auth0 from "@auth0/auth0-fastify";
import { config } from "./config.js";
import { registerHealthRoutes } from "./routes/health.js";
import { registerEnrollmentRoutes } from "./routes/enrollment.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerCallRoutes } from "./routes/calls.js";
import { registerSecondRingRoutes } from "./routes/secondring.js";
import { registerLeadRoutes } from "./routes/leads.js";
import { registerSupplierRoutes } from "./routes/suppliers.js";
import { registerSupplierAdminRoutes } from "./routes/supplier-admin.js";
import { registerPhonePoolRoutes } from "./routes/phone-pool.js";
import { registerCollectorRoutes } from "./routes/collector.js";
import { registerDashboardRoutes } from "./routes/dashboard.js";
import { registerTelephonyRoutes } from "./routes/telephony.js";
import { registerOmnichannelRoutes } from "./routes/omnichannel.js";
import { registerOutcomeRoutes } from "./routes/outcomes.js";
import { registerReportRoutes } from "./routes/reports.js";
import { registerLeadSearchRoutes } from "./routes/lead-search.js";
import { registerDidwwRoutes } from "./routes/didww.js";
import { registerTwilioRoutes } from "./routes/twilio.js";
import { registerWhatConvertsRoutes } from "./routes/whatconverts.js";
import { registerPressPilotRoutes } from "./routes/presspilot.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
    bodyLimit: config.EVENT_MAX_BODY_BYTES,
    requestTimeout: 10000
  });
  const allowedOrigins = config.CORS_ORIGINS.split(",").map((v) => v.trim()).filter(Boolean);
  app.register(cors, { origin: allowedOrigins.length ? allowedOrigins : false, credentials: false });
  app.register(formbody);
  const auth0Configured = Boolean(
    config.AUTH0_DOMAIN &&
    config.AUTH0_CLIENT_ID &&
    config.AUTH0_CLIENT_SECRET &&
    config.AUTH0_SESSION_SECRET
  );
  const auth0Provided = [
    config.AUTH0_DOMAIN,
    config.AUTH0_CLIENT_ID,
    config.AUTH0_CLIENT_SECRET,
    config.AUTH0_SESSION_SECRET
  ].filter(Boolean).length;
  if (auth0Provided > 0 && !auth0Configured) {
    throw new Error("Auth0 configuration is incomplete: set AUTH0_DOMAIN, AUTH0_CLIENT_ID, AUTH0_CLIENT_SECRET, and AUTH0_SESSION_SECRET together.");
  }
  if (auth0Configured) {
    app.register(auth0, {
      domain: config.AUTH0_DOMAIN!,
      clientId: config.AUTH0_CLIENT_ID!,
      clientSecret: config.AUTH0_CLIENT_SECRET!,
      appBaseUrl: config.AUTH0_APP_BASE_URL,
      sessionSecret: config.AUTH0_SESSION_SECRET!,
      sessionConfiguration: {
        rolling: true,
        absoluteDuration: 7 * 24 * 60 * 60,
        inactivityDuration: 12 * 60 * 60,
        cookie: {
          name: "analog_auth0_session",
          sameSite: "lax",
          secure: config.NODE_ENV === "production"
        }
      }
    });
  }
  app.register(registerHealthRoutes);
  app.register(registerEnrollmentRoutes);
  app.register(registerEventRoutes);
  app.register(registerCallRoutes);
  app.register(registerSecondRingRoutes);
  app.register(registerTwilioRoutes);
  if (config.ENABLE_WHATCONVERTS) {
    app.register(registerWhatConvertsRoutes);
  }
  app.register(registerTelephonyRoutes);
  app.register(registerLeadRoutes);
  app.register(registerSupplierRoutes);
  app.register(registerSupplierAdminRoutes);
  app.register(registerPhonePoolRoutes);
  app.register(registerCollectorRoutes);
  app.register(registerDidwwRoutes);
  app.register(registerOmnichannelRoutes);
  app.register(registerOutcomeRoutes);
  app.register(registerReportRoutes);
  app.register(registerLeadSearchRoutes);
  app.register(registerDashboardRoutes);
  app.register(registerPressPilotRoutes);
  return app;
}
