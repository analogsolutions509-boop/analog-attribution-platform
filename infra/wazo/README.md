# Analog Voice Infrastructure

## Target architecture

Analog Attribution Platform remains on Railway.
Wazo Platform runs on a dedicated Debian 12 host with public SIP/RTP networking.
DIDWW supplies UK DIDs and SIP trunks.
Analog API receives Wazo HTTP call events over HTTPS.

## Wazo host requirements

Wazo's current Unified Communication installation targets Debian 12 Bookworm. The current installation guide lists 2 CPU, 4 GiB RAM and 50 GiB storage as minimum expected resources for the small production profile.

## Install stable Wazo

Run `install-stable.sh` as root on the Debian 12 host. It prepares the current stable Wazo Ansible release under `/opt/wazo-ansible`; the site-specific inventory must then be configured before the Wazo playbook is executed.

## Analog integration

Set these values in the Analog API environment:

    TELEPHONY_PROVIDER=wazo
    WAZO_API_URL=https://wazo.example.com
    WAZO_AUTH_TOKEN=<Wazo API token>
    WAZO_WEBHOOK_SECRET=<high-entropy secret>
    WAZO_CONTEXT=default

The Analog API exposes:

    POST /v1/providers/wazo/webhook
    POST /v1/providers/wazo/webhook/:event/:token
    POST /v1/telephony/calls/:callId/transfer
    POST /v1/telephony/transfers/:transferId/complete

### Wazo HTTP event delivery

Wazo's current HTTP webhook service renders a configured URL from the values `event_name`, `event` and `wazo_uuid`. When no custom body is configured, it sends the event data JSON only. The official Wazo source also shows that the HTTP service does not define arbitrary outbound headers in the HTTP subscription config.

For Analog, use this callback template:

    https://api-jyu9-production.up.railway.app/v1/providers/wazo/webhook/{{ event_name }}/<derived-token>

The event path is restricted to `call_created`, `call_updated`, and `call_ended`. The callback token is a URL-safe SHA-256-derived value from `WAZO_WEBHOOK_SECRET`; the raw secret is never put in the URL.

Run `scripts/wazo-webhook-bootstrap.sh` on a machine that can reach Wazo after exporting `WAZO_API_URL`, `WAZO_AUTH_TOKEN`, `PUBLIC_API_URL`, and `WAZO_WEBHOOK_SECRET`. It creates or updates the `Analog Call Events` subscription idempotently. Set `WAZO_TENANT_UUID` when the Wazo account requires an explicit tenant header.

## Site resolution requirement

The Wazo dialplan must preserve each inbound tracking DID in `dialed_extension` (or another populated destination-number field) so the Analog callback can resolve the call to the correct website tracking number. This is a provisioning invariant for the 150-site rollout.

## Carrier flow

Customer -> DIDWW UK DID -> Wazo SIP trunk -> agent/supplier call flow
                                -> Wazo call event
                                -> Analog attribution
                                -> AI/transcript/R2
                                -> Analog OS

## Current external gate

The existing SSH host at `82.29.191.115:65002` is reachable at the network level but no usable private key or SSH-agent identity is available on the connected workstation, so it cannot be safely administered yet.

The next host can be provisioned through DigitalOcean once that account connector is connected. The application-side Wazo integration is already prepared and tested.