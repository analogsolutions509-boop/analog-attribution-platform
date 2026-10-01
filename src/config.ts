import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ANALOG_SITE_KEY_SECRET: z.string().min(16),
  ANALOG_ENROLLMENT_SECRET: z.string().min(16),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-4o-transcribe-diarize"),
  OPENAI_INTELLIGENCE_MODEL: z.string().default("gpt-5.6-luna"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().default("analog-call-recordings"),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  EVENT_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(1048576).default(65536)
});

export const config = envSchema.parse(process.env);
