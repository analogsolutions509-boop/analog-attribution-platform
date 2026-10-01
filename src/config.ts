import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development","test","production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4100),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ANALOG_SITE_KEY_SECRET: z.string().min(16),
  ANALOG_ENROLLMENT_SECRET: z.string().min(16),
  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default("gpt-transcribe"),
  OPENAI_INTELLIGENCE_MODEL: z.string().default("gpt-5.6-luna"),
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  DEEPGRAM_MODEL: z.string().default("nova-3"),
  DEEPGRAM_DIARIZE_MODEL: z.string().default("latest"),
  TRANSCRIPTION_PROVIDER: z.enum(["deepgram","openai"]).default("deepgram"),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_BUCKET: z.string().default("analog-call-recordings"),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  EVENT_MAX_BODY_BYTES: z.coerce.number().int().min(1024).max(1048576).default(65536),
  RECORDING_MAX_BYTES: z.coerce.number().int().min(1048576).max(104857600).default(26214400),
  CORS_ORIGINS: z.string().default("*"),
  PUBLIC_API_URL: z.string().url().optional(),
  ANALOG_OS_WEBHOOK_URL: z.string().url().optional(),
  ANALOG_OS_WEBHOOK_SECRET: z.string().optional()
});

export const config = envSchema.parse(process.env);
