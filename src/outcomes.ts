import { createHmac, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { db } from "./db.js";

const allowed = new Set(["sale","quoted","no_sale","pending_sale"]);

function hashToken(token:string) {
  return createHmac("sha256", config.ANALOG_SITE_KEY_SECRET).update(token).digest("hex");
}

export function createOutcomeToken(leadId:string, supplierId?:string|null, days=7) {
  const raw = "out_" + randomBytes(32).toString("base64url");
  return {
    raw,
    hash: hashToken(raw),
    leadId,
    supplierId: supplierId ?? null,
    expiresAt: new Date(Date.now()+days*86400000)
  };
}

export function outcomeName(value:string) {
  const normalized=value.trim().toLowerCase().replaceAll("-","_");
  return allowed.has(normalized) ? normalized : null;
}

export async function consumeOutcomeToken(token:string,outcome:string) {
  const normalized=outcomeName(outcome);
  if(!normalized) throw new Error("invalid_outcome");
  const result=await db.query(
    "SELECT id,lead_id,supplier_id FROM lead_outcome_tokens WHERE token_hash=$1 AND expires_at>NOW() AND used_at IS NULL FOR UPDATE",
    [hashToken(token)]
  );
  if(!result.rowCount) throw new Error("outcome_token_invalid_or_expired");
  const row=result.rows[0];
  await db.query("UPDATE lead_outcome_tokens SET used_at=NOW() WHERE id=$1",[row.id]);
  const status = normalized === "sale" ? "sale" :
    normalized === "quoted" ? "quoted" :
    normalized === "pending_sale" ? "pending sale" : "no sale";
  await db.query("UPDATE leads SET outcome=$2,status=$3,updated_at=NOW() WHERE id=$1",[row.lead_id,normalized,status]);
  const { queueAnalogOSEvent } = await import("./analog-os-outbox.js");
  await queueAnalogOSEvent("lead.outcome.updated","lead",row.lead_id,{
    lead_id:row.lead_id,supplier_id:row.supplier_id ?? null,outcome:normalized
  });
  return {leadId:row.lead_id,supplierId:row.supplier_id ?? null,outcome:normalized};
}