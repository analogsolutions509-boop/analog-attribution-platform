# Analog Voice Infrastructure

## Target architecture

Analog Attribution Platform remains on Railway.
Wazo Platform runs on a dedicated Debian 12 host with public SIP/RTP networking.
DIDWW supplies UK DIDs and SIP trunks.
Analog API receives DIDWW Call Events over HTTPS.

## Wazo host requirements

Wazo's current Unified Communication installation targets Debian 12 Bookworm.
For a small production deployment, the current installation guide lists 2 CPU, 4 GiB RAM and 50 GiB storage as minimum expected resources.

## Install stable Wazo

Run as root on the Debian 12 host:

    apt update
    apt install -yq sudo git ansible curl
    git clone https://github.com/wazo-platform/wazo-ansible.git
    cd wazo-ansible
    ansible_tag=wazo-$(curl -fsSL https://mirror.wazo.community/version/stable)
    git checkout "$ansible_tag"
    ansible-galaxy install -r requirements-postgresql.yml

Configure inventories/uc-engine with:
- pelican-bookworm as the stable Wazo distribution
- root/API credentials
- the UC UI when required

Then run:

    ansible-playbook -i inventories/uc-engine uc-engine.yml

## Analog integration

Set the following values in the Analog API environment:

    TELEPHONY_PROVIDER=wazo
    WAZO_API_URL=https://wazo.your-domain.example
    WAZO_AUTH_TOKEN=<generated Wazo token>
    WAZO_WEBHOOK_SECRET=<random secret>
    WAZO_CONTEXT=default

The Analog API already exposes:

    POST /v1/providers/wazo/webhook
    POST /v1/telephony/calls/:callId/transfer
    POST /v1/telephony/transfers/:transferId/complete

## DIDWW integration

DIDWW Call Events should target:

    https://api-jyu9-production.up.railway.app/v1/providers/didww/call-events

Use either:
- a custom header such as X-Auth-Token containing DIDWW_CALLBACK_SECRET, or
- Basic Authentication using DIDWW_CALLBACK_USERNAME and DIDWW_CALLBACK_PASSWORD

Disable gzip compression for the first activation so the current HTTP JSON receiver can be validated without an intermediary decompressor.

DIDWW Call Events must be enabled on the DIDWW account by Technical Support.

## Carrier flow

Customer -> DIDWW UK DID -> Wazo SIP trunk -> supplier/customer leg
                                -> Analog call event
                                -> Analog attribution
                                -> AI/transcript/R2
                                -> Analog OS

## Current activation blocker

The workspace has an existing SSH host at 82.29.191.115:65002, but no accepted SSH key is currently available from the workstation. Do not create a second server until the existing access path is recovered or a replacement Debian 12 host is intentionally provisioned.
