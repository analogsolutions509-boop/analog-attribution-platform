import type { FastifyInstance } from "fastify";
import { config } from "../config.js";
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

  // This intentionally reports aggregate counts only. It is safe for external
  // monitoring and does not expose phone numbers, supplier contacts, or secrets.
  app.get("/v1/health/call-tracking", async (_request, reply) => {
    try {
      const result = await db.query(`
        SELECT
          (SELECT COUNT(*)::int FROM sites WHERE status='active') AS active_sites,
          (SELECT COUNT(*)::int FROM sites s
             WHERE s.status='active'
               AND EXISTS (
                 SELECT 1 FROM tracking_numbers tn
                 WHERE tn.site_id=s.id AND tn.active
               )
          ) AS sites_with_tracking_numbers,
          (SELECT COUNT(*)::int FROM sites s
             WHERE s.status='active'
               AND EXISTS (
                 SELECT 1 FROM tracking_numbers tn
                 JOIN forwarding_numbers fn ON fn.id=tn.forwarding_number_id AND fn.active
                 WHERE tn.site_id=s.id AND tn.active
               )
          ) AS sites_with_forwarding_routes,
          (SELECT COUNT(*)::int FROM tracking_numbers WHERE active) AS active_tracking_numbers,
          (SELECT COUNT(*)::int FROM forwarding_numbers WHERE active) AS active_forwarding_numbers
      `);
      const row = result.rows[0] ?? {};
      const activeSites = Number(row.active_sites ?? 0);
      const sitesWithNumbers = Number(row.sites_with_tracking_numbers ?? 0);
      const sitesWithRoutes = Number(row.sites_with_forwarding_routes ?? 0);
      const activeTrackingNumbers = Number(row.active_tracking_numbers ?? 0);
      const activeForwardingNumbers = Number(row.active_forwarding_numbers ?? 0);
      const provider = config.TELEPHONY_PROVIDER;
      const providerConfigured = provider === "twilio"
        ? Boolean(config.TWILIO_ACCOUNT_SID && config.TWILIO_AUTH_TOKEN && config.TWILIO_OPERATOR_NUMBER)
        : provider === "wazo"
          ? Boolean(config.WAZO_API_URL && config.WAZO_AUTH_TOKEN)
          : Boolean(config.ANALOG_PROVIDER_WEBHOOK_SECRET);

      const reasons: string[] = [];
      if (!activeTrackingNumbers) reasons.push("tracking_numbers_missing");
      if (!activeForwardingNumbers) reasons.push("forwarding_numbers_missing");
      if (activeSites > sitesWithNumbers) reasons.push("active_sites_missing_tracking_numbers");
      if (sitesWithNumbers > sitesWithRoutes) reasons.push("tracking_numbers_missing_forwarding_routes");
      if (!providerConfigured) reasons.push("telephony_provider_not_configured");

      const status = reasons.length ? "degraded" : "ready";
      return reply.code(reasons.length ? 503 : 200).send({
        status,
        provider,
        provider_configured: providerConfigured,
        counts: {
          active_sites: activeSites,
          sites_with_tracking_numbers: sitesWithNumbers,
          sites_with_forwarding_routes: sitesWithRoutes,
          active_tracking_numbers: activeTrackingNumbers,
          active_forwarding_numbers: activeForwardingNumbers
        },
        reasons
      });
    } catch {
      return reply.code(503).send({
        status: "unavailable",
        reasons: ["call_tracking_health_query_failed"]
      });
    }
  });
}
