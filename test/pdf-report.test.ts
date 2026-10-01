import test from "node:test";
import assert from "node:assert/strict";
import { generateReportPdf } from "../src/pdf-report.ts";

test("generates a non-empty PDF",async()=>{
  const report={kpi:{leads:12,touched:8,sales:3},daily:[{day:"2026-10-01",leads:4}],suppliers:[{supplier:"Primary",leads:8,sales:2},{supplier:"Fallback",leads:4,sales:1}]};
  const pdf=await generateReportPdf(report,"2026-09-01T00:00:00Z","2026-10-01T00:00:00Z");
  assert.equal(pdf.subarray(0,5).toString().startsWith("%PDF-"),true);
  assert.ok(pdf.length>1000);
});
