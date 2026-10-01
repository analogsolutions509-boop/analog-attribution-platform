# Analog Attribution Platform

First-party attribution, call intelligence, recording archive, lead intelligence, supplier routing, and Analog OS integration platform.

## Foundation V1
- Secure site-authenticated event ingestion
- PostgreSQL canonical event store
- Redis background queue
- Durable retry/dead-letter jobs
- Automatic site enrollment
- WordPress collector
- Call ingestion API
- Private recording archive abstraction (Cloudflare R2)
- Full transcript storage
- Speaker diarization adapter
- Structured AI call intelligence with evidence timestamps
- Construction-specific order/requirement extraction
- Health/readiness endpoints
- Migration-based schema
- Test-first development

## Current stack
- API + worker: Node.js 24 / TypeScript
- Database: PostgreSQL
- Queue: Redis
- Storage: Cloudflare R2
- Diarization: Deepgram Nova + batch diarizer latest
- AI analysis: OpenAI Responses API, default gpt-5.6-luna
- Primary production host: Railway
- Fleet deployment target: MainWP
- Website collector: WordPress plugin

## Repository layout
src/  - application source
migrations/  - database migrations
wordpress/analog-attribution-collector/  - fleet collector
test/  - automated tests

## Local development
1. Copy .env.example to .env.
2. Set PostgreSQL, Redis, enrollment, and site-key secrets.
3. Add Deepgram and OpenAI keys when enabling production transcription/intelligence.
4. Run npm install.
5. Run npm test.
6. Run npm run build.
7. Run npm run migrate against the target database.

## Call-intelligence flow
SecondRing -> call event -> call record -> recording archive -> transcription + diarization -> full conversation transcript -> structured AI extraction -> evidence-backed fields -> lead enrichment -> supplier routing -> Analog OS.

SecondRing's public site documents call recording, secure cloud recording storage, call history, and an API/webhook integration surface. The public API page specifically documents webhooks for SMS and missed calls, so recording export remains behind the provider adapter until the account-specific recording payload is confirmed. The adapter accepts authenticated provider calls, normalizes common field shapes, and can resolve a site from the called tracking number.

## Deployment
Railway production project: Analog Attribution Platform.
The production environment has PostgreSQL, Redis, an API service, and a worker service configured. API and worker deploy from the GitHub repository's `main` branch. The provider webhook endpoint is `POST /v1/providers/secondring/webhook` and requires the production provider webhook secret.

## Security principles
- No public database or Redis
- Site keys are stored hashed
- Site keys are not sent to visitor JavaScript
- WordPress acts as a same-origin proxy
- Recordings are private objects
- Recording downloads use short-lived signed URLs
- AI output is constrained to a strict schema
- Extracted facts retain transcript evidence
