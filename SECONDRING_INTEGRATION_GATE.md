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
