# PressPilot

PressPilot has two coordinated interfaces.

1. WordPress plugin: installs on each managed site and provides the secure execution agent.
2. ChatGPT/Agent Plugin: exposes PressPilot's hosted MCP tools so ChatGPT and Codex can inspect and operate connected sites.

## WordPress package

The installable package is generated from wordpress/presspilot-agent/presspilot-agent.php and includes a WordPress-compatible readme.

## ChatGPT package

The package uses the portable Agent Plugins manifest plus a streamable HTTP MCP server configuration. The hosted MCP endpoint currently requires the PressPilot bearer token for development. For public ChatGPT distribution, this authentication boundary must be replaced or fronted by OAuth 2.1 and then submitted for review.

## Hosted MCP endpoint

https://api-jyu9-production.up.railway.app/mcp

## Source

Hosted PressPilot source lives in src/presspilot*.ts, src/routes/presspilot.ts, and wordpress/presspilot-agent/.
