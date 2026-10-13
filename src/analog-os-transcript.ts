export type TranscriptCallContext = {
  id: string;
  site_id: string;
  site_name?: string | null;
  hostname?: string | null;
  provider?: string | null;
  provider_call_id?: string | null;
  caller_number?: string | null;
  called_number?: string | null;
  direction?: string | null;
  started_at?: string | Date | null;
  ended_at?: string | Date | null;
  duration_seconds?: number | null;
  attribution_method?: string | null;
  recording_status?: string | null;
  recording_storage_key?: string | null;
  recording_sha256?: string | null;
};

export type TranscriptPayload = {
  provider: string;
  model: string;
  duration: number;
  text: string;
  segments: Array<{
    id: string;
    start: number;
    end: number;
    text: string;
    speaker: string;
  }>;
  language?: string | null;
};

function isoOrNull(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/**
 * Creates a provider-neutral, auditable transcript-completion event.
 * The complete text and diarized segments are sent to the signed OS outbox
 * only after the recording has been archived and the transcript persisted.
 */
export function buildTranscriptCompletedData(
  call: TranscriptCallContext,
  transcriptId: string,
  transcript: TranscriptPayload,
  completedAt = new Date()
) {
  return {
    call_id: call.id,
    transcript_id: transcriptId,
    site_id: call.site_id,
    site_name: call.site_name ?? null,
    hostname: call.hostname ?? null,
    provider: call.provider ?? null,
    provider_call_id: call.provider_call_id ?? null,
    caller_number: call.caller_number ?? null,
    called_number: call.called_number ?? null,
    direction: call.direction ?? null,
    started_at: isoOrNull(call.started_at),
    ended_at: isoOrNull(call.ended_at),
    duration_seconds: call.duration_seconds ?? transcript.duration,
    attribution_method: call.attribution_method ?? "unknown",
    recording_status: call.recording_status ?? null,
    recording_storage_key: call.recording_storage_key ?? null,
    recording_sha256: call.recording_sha256 ?? null,
    transcript_status: "complete",
    transcript_provider: transcript.provider,
    transcript_model: transcript.model,
    transcript_language: transcript.language ?? null,
    transcript_text: transcript.text,
    transcript_segments: transcript.segments,
    transcript_duration_seconds: transcript.duration,
    transcript_completed_at: completedAt.toISOString()
  };
}
