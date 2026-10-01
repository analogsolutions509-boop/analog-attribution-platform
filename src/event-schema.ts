import { z } from "zod";

export const eventSchema = z.object({
  event_key: z.string().min(1).max(120),
  event_name: z.string().regex(/^[a-z0-9_:-]{1,80}$/),
  occurred_at: z.string().datetime(),
  visitor_key: z.string().min(1).max(200),
  session_key: z.string().min(1).max(200),
  page_url: z.string().url().nullable().optional(),
  page_path: z.string().max(2048).nullable().optional(),
  referrer: z.string().max(2048).nullable().optional(),
  utm_source: z.string().max(200).nullable().optional(),
  utm_medium: z.string().max(200).nullable().optional(),
  utm_campaign: z.string().max(200).nullable().optional(),
  utm_term: z.string().max(200).nullable().optional(),
  utm_content: z.string().max(200).nullable().optional(),
  payload: z.record(z.string(), z.unknown()).default({})
});

export type CollectorEvent = z.infer<typeof eventSchema>;
