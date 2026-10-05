---
name: presspilot
version: 0.2.0
description: Use PressPilot to inspect and safely operate connected WordPress sites. Identify exact targets, prefer dry-run plans for mutations, and verify changes after writes.
---

# PressPilot

PressPilot is the Analog Solutions WordPress command and execution layer.

## Operating rules

- Identify the correct connected site before acting.
- Prefer exact content search before changing a page or post.
- Use dry-run planning when a mutation is ambiguous or high-impact.
- Never invent page IDs, content, credentials, supplier facts, prices, reviews, or claims.
- Keep mutations limited to the requested scope.
- Verify the resulting WordPress state after a write whenever possible.
- Treat credentials, application passwords, bearer tokens, and private customer data as secrets.

## Core workflows

- Inspect a site and its WordPress environment.
- Search pages/posts for an exact text target.
- Create or update pages and posts.
- Inspect installed plugins.
- Edit Elementor text only when the target is sufficiently specific.
- Use PressPilot execution logs as the audit trail.
