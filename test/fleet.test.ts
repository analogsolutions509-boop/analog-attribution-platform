import test from "node:test";
import assert from "node:assert/strict";
import { normalizeFleetSites } from "../src/fleet.ts";

test("normalizes a bulk fleet setup request", () => {
  const result = normalizeFleetSites({
    sites: [
      {
        hostname: " BirminghamReadyMix.co.uk ",
        name: "Birmingham Ready Mix",
        tracking_numbers: ["+44 161 555 0100", "0161 555 0101"]
      }
    ]
  });

  assert.deepEqual(result, [
    {
      hostname: "birminghamreadymix.co.uk",
      name: "Birmingham Ready Mix",
      trackingNumbers: ["441615550100", "01615550101"]
    }
  ]);
});

test("rejects duplicate hostnames or tracking numbers in one request", () => {
  assert.throws(
    () =>
      normalizeFleetSites({
        sites: [
          { hostname: "a.example", name: "A", tracking_numbers: ["+44 7000 111111"] },
          { hostname: " A.EXAMPLE ", name: "A2", tracking_numbers: ["+44 7000 222222"] }
        ]
      }),
    /duplicate_hostname/
  );

  assert.throws(
    () =>
      normalizeFleetSites({
        sites: [
          { hostname: "a.example", name: "A", tracking_numbers: ["+44 7000 111111"] },
          { hostname: "b.example", name: "B", tracking_numbers: ["+44 7000 111111"] }
        ]
      }),
    /duplicate_tracking_number/
  );
});

test("rejects malformed or oversized fleet requests", () => {
  assert.throws(() => normalizeFleetSites({ sites: [] }), /sites_required/);
  assert.throws(
    () => normalizeFleetSites({ sites: [{ hostname: "not-a-host", name: "Site" }] }),
    /invalid_hostname/
  );
  assert.throws(
    () => normalizeFleetSites({ sites: [{ hostname: "a.example", name: " " }] }),
    /name_required/
  );
  assert.throws(
    () =>
      normalizeFleetSites({
        sites: Array.from({ length: 201 }, (_, i) => ({
          hostname: `site${i}.example.com`,
          name: `Site ${i}`
        }))
      }),
    /too_many_sites/
  );
});
