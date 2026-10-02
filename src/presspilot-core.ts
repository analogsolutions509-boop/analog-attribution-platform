import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { z } from "zod";

const PAIRING_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function generatePairingCode(): string {
  const bytes = randomBytes(10);
  let value = "";
  for (let i = 0; i < 10; i++) value += PAIRING_ALPHABET[bytes[i] % PAIRING_ALPHABET.length];
  return value.slice(0, 4) + "-" + value.slice(4);
}

export function isPairingCodeFormatValid(value: string): boolean {
  return /^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{6}$/.test(value);
}

export function hashPairingCode(code: string, secret: string): string {
  return createHash("sha256").update(secret + ":pairing:" + code.trim().toUpperCase(), "utf8").digest("hex");
}

export function generateAgentToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAgentToken(token: string, _secret?: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export const PRESSPILOT_OPERATIONS = [
  "get_site",
  "list_posts",
  "list_pages",
  "create_post",
  "update_post",
  "create_page",
  "update_page",
  "list_plugins",
  "search_content",
  "elementor_edit_text"
] as const;

export type PressPilotOperation = typeof PRESSPILOT_OPERATIONS[number];

const operationSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("get_site"), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ op: z.literal("list_posts"), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ op: z.literal("list_pages"), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ op: z.literal("create_post"), args: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("update_post"), args: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("create_page"), args: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("update_page"), args: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("list_plugins"), args: z.record(z.string(), z.unknown()).default({}) }),
  z.object({ op: z.literal("search_content"), args: z.record(z.string(), z.unknown()) }),
  z.object({ op: z.literal("elementor_edit_text"), args: z.record(z.string(), z.unknown()) })
]);

export const pressPilotPlanSchema = z.object({
  operations: z.array(operationSchema).min(1).max(5)
});

export type PressPilotPlan = z.infer<typeof pressPilotPlanSchema>;

export function normalizeWordPressUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("invalid_wordpress_url");
  return url.origin.toLowerCase();
}

export function deriveEncryptionKey(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}
export function encryptSecret(plainText: string, secret: string): string {
  const key = deriveEncryptionKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plainText, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv, tag, ciphertext].map((part) => part.toString("base64url")).join(".");
}

export function decryptSecret(encoded: string, secret: string): string {
  const [ivText, tagText, ciphertextText] = encoded.split(".");
  if (!ivText || !tagText || !ciphertextText) throw new Error("invalid_encrypted_secret");
  const decipher = createDecipheriv("aes-256-gcm", deriveEncryptionKey(secret), Buffer.from(ivText, "base64url"));
  decipher.setAuthTag(Buffer.from(tagText, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextText, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function validatePressPilotPlan(input: unknown): PressPilotPlan {
  const result = pressPilotPlanSchema.safeParse(input);
  if (!result.success) {
    const issue = result.error.issues[0];
    const message = issue?.path[0] === "operations" ? "unsupported_operation" : "invalid_plan";
    throw new Error(message);
  }
  return result.data;
}

export function summarizeOperation(op: PressPilotOperation): string {
  return op.replaceAll("_", " ");
}
