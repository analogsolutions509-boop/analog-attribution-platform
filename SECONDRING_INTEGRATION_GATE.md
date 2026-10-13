# SecondRing Integration Gate

## Public capabilities verified on 1 October 2026

SecondRing publicly documents:
- Call recording
- Secure cloud storage of recordings
- Search/filter/listen access to recordings in the control panel
- Call history
- API and webhooks for supported integration events
- Publicly advertised webhook examples focused on supported SMS and missed-call events

## What Analog must confirm against the actual account
1. Call-created/completed webhook payload
2. Unique provider call ID
3. Recording identifier
4. Recording export/download endpoint or signed recording URL
5. Authentication method
6. Recording availability delay after call completion
7. Recording format
8. Retention period
9. Recording consent/announcement configuration required for the deployment

The platform deliberately does not fake fields or invent an endpoint. Once the account payload is available, the IncomingCall adapter and archiveRecording path already provide the target interface.

## Target flow
SecondRing -> call adapter -> PostgreSQL call record -> recording archive -> transcript/diarization -> AI extraction -> lead.


## Shared SecondRing line behavior added on 14 October 2026

- Migration 021 creates the paused internal sink site `shared-secondring-line.internal` and records an explicit `attribution_method` on calls.
- SecondRing events with a valid site ID use that site; otherwise a registered dedicated number match is used; if neither matches, the call is stored against **SecondRing Shared Line (Unattributed)**. The receiver must never guess among the 21 public websites.
- Once an authenticated event contains a stable call ID and a secure recording URL, the worker archives the recording to private R2, transcribes it, stores the complete text and speaker segments in PostgreSQL, and enqueues a signed `transcript.completed` event containing the full transcript and archive metadata.
- The Analog OS webhook writes/upserts the full transcript and segments into the `Attribution Transcripts` tab. A later AI-summary event updates the same Call ID row rather than duplicating it or overwriting the transcript.
- A live call has not yet passed end-to-end. The account-specific SecondRing webhook payload/authentication and recording download access still need verification, followed by a real test call before rolling the shared phone number onto all sites.
