# Analog Attribution Platform

First-party attribution, call intelligence, recording archive, lead intelligence, supplier routing, and Analog OS integration platform.

## Foundation V1

- Secure site-authenticated event ingestion
- PostgreSQL canonical event store
- Redis background queue
- Health/readiness endpoints
- Idempotent event ingestion
- Migration-based schema
- Test-first development

## Local development

1. Copy .env.example to .env and set DATABASE_URL and REDIS_URL.
2. Run npm install.
3. Run npm test.
4. Run npm run dev.

## Architecture

WordPress Collector -> /v1/events -> PostgreSQL -> Redis -> workers -> attribution/call/lead intelligence.
