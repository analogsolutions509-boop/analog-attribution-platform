# DIDWW activation

## Call Events

Endpoint:
https://api-jyu9-production.up.railway.app/v1/providers/didww/call-events

Authentication:
- Custom header: X-Auth-Token
- Header value is stored in Railway as DIDWW_CALLBACK_SECRET
- GZIP disabled for the first validation

DIDWW must enable Call Events API for the account. The service can deliver Voice IN and Voice OUT start, connect and end events in real time.

## UK number and SIP setup

Use a UK geographic DID when a city-specific caller ID is required, or a UK mobile DID when mobile presentation is required.

Route the DID to the Wazo SIP trunk.
Wazo handles PBX and call-control; Analog handles attribution, AI, recording archive, reporting and supplier workflows.

## First activation sequence

1. Obtain DIDWW API access.
2. Ask DIDWW Support to enable Call Events API.
3. Configure the endpoint above.
4. Configure the X-Auth-Token header to the secret generated in Railway.
5. Provision the UK DID.
6. Route the DID to the Wazo SIP trunk.
7. Connect the Wazo node to Analog.
8. Place a test inbound call.
9. Verify start/connect/end events.
10. Verify website attribution and dashboard reporting.
