import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyPaystackStatus } from "../src/lib/paystack-status";

describe("Paystack verification status classification", () => {
  it("keeps pending and in-progress gateway states pending", () => {
    for (const status of ["ongoing", "pending", "processing", "queued"]) {
      assert.equal(classifyPaystackStatus(status), "PENDING");
    }
  });

  it("treats success case-insensitively", () => {
    assert.equal(classifyPaystackStatus("success"), "SUCCESS");
    assert.equal(classifyPaystackStatus(" SUCCESS "), "SUCCESS");
  });

  it("fails closed for failed, unknown and malformed statuses", () => {
    for (const status of ["failed", "abandoned", "reversed", "", null, 42]) {
      assert.equal(classifyPaystackStatus(status), "FAILED");
    }
  });
});
