#!/usr/bin/env bash
set -euo pipefail

: "${WAZO_API_URL:?WAZO_API_URL is required}"
: "${WAZO_AUTH_TOKEN:?WAZO_AUTH_TOKEN is required}"
: "${PUBLIC_API_URL:?PUBLIC_API_URL is required}"
: "${WAZO_WEBHOOK_SECRET:?WAZO_WEBHOOK_SECRET is required}"

CALLBACK_TOKEN="$(printf '%s' "$WAZO_WEBHOOK_SECRET" | openssl dgst -sha256 -binary | openssl base64 -A | tr '+/' '-_' | tr -d '=')"
CALLBACK_URL="${PUBLIC_API_URL%/}/v1/providers/wazo/webhook/{{ event_name }}/${CALLBACK_TOKEN}"
SUBSCRIPTION_NAME="Analog Call Events"

headers=(-H "X-Auth-Token: ${WAZO_AUTH_TOKEN}" -H "Content-Type: application/json")
if [[ -n "${WAZO_TENANT_UUID:-}" ]]; then
  headers+=(-H "Wazo-Tenant: ${WAZO_TENANT_UUID}")
fi

payload="$(jq -cn \
  --arg name "$SUBSCRIPTION_NAME" \
  --arg url "$CALLBACK_URL" \
  '{name:$name,service:"http",events:["call_created","call_updated","call_ended"],config:{method:"post",url:$url,verify_certificate:"true"}}')"

subscriptions="$(curl -fsS "${headers[@]}" "${WAZO_API_URL%/}/api/webhookd/1.0/subscriptions")"
existing_uuid="$(printf '%s' "$subscriptions" | jq -r --arg name "$SUBSCRIPTION_NAME" '.items[]? | select(.name == $name) | .uuid' | head -n1)"

if [[ -n "$existing_uuid" && "$existing_uuid" != "null" ]]; then
  curl -fsS -X PUT "${headers[@]}" --data "$payload" \
    "${WAZO_API_URL%/}/api/webhookd/1.0/subscriptions/${existing_uuid}" >/dev/null
  echo "Updated Wazo webhook subscription: ${SUBSCRIPTION_NAME} (${existing_uuid})"
else
  response="$(curl -fsS -X POST "${headers[@]}" --data "$payload" "${WAZO_API_URL%/}/api/webhookd/1.0/subscriptions")"
  uuid="$(printf '%s' "$response" | jq -r '.uuid // empty')"
  echo "Created Wazo webhook subscription: ${SUBSCRIPTION_NAME}${uuid:+ (${uuid})}"
fi

echo "Callback endpoint: ${PUBLIC_API_URL%/}/v1/providers/wazo/webhook/{{ event_name }}/<derived-token>"
echo "Events: call_created, call_updated, call_ended"