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

SecondRing's public site currently documents call recording, secure cloud recording storage, call history, and an API/webhook integration surface. Their public integration page specifically mentions supported SMS and missed-call events, so the recording export payload is intentionally kept behind an adapter until the account-specific interface is confirmed.

## Deployment
Railway production project: Analog Attribution Platform.
The production environment has PostgreSQL, Redis, an API service, and a worker service configured. The remaining source-control deployment handoff is connecting this local repository to an authorized GitHub repository so Railway can build from source.

## Security principles
- No public database or Redis
- Site keys are stored hashed
- Site keys are not sent to visitor JavaScript
- WordPress acts as a same-origin proxy
- Recordings are private objects
- Recording downloads use short-lived signed URLs
- AI output is constrained to a strict schema
- Extracted facts retain transcript evidence
