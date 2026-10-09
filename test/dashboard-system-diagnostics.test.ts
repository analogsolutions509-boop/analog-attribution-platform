import test from "node:test";
import assert from "node:assert/strict";

test("dashboard system diagnostics group queued jobs by type and classify dead letters safely", async () => {
  const [{ buildDashboardJobsByTypeQuery, buildDashboardDeadLetterSummaryQuery }, { redis }] = await Promise.all([
    import("../src/routes/dashboard.ts"),
    import("../src/queue.ts")
  ]);
  redis.disconnect();

  const byType = buildDashboardJobsByTypeQuery();
  assert.match(byType, /SELECT\s+job_type\s*,\s*status/i);
  assert.match(byType, /COUNT\(\*\)::int AS count/i);
  assert.match(byType, /GROUP BY job_type,status/i);

  const deadLetters = buildDashboardDeadLetterSummaryQuery();
  assert.match(deadLetters, /WHERE status='dead_letter'/i);
  assert.match(deadLetters, /error_category/i);
  assert.match(deadLetters, /collector_event_utm_schema_mismatch/i);
  assert.match(deadLetters, /GROUP BY job_type,error_category/i);
  assert.doesNotMatch(deadLetters, /SELECT\s+.*last_error\s*,/i);
});
