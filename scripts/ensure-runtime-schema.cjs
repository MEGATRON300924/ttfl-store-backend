const { spawnSync } = require("node:child_process");
const path = require("node:path");

// Runtime schema compatibility is best-effort. The API should still start when
// Neon is temporarily unreachable; database-backed requests can then fail normally
// instead of causing Render to crash-loop the service.
const checks = [
  "ensure-coming-soon-schema.cjs",
  "ensure-digital-postcode-schema.cjs",
  "ensure-store-reports-schema.cjs",
  "ensure-review-category-schema.cjs",
  "ensure-terms-schema.cjs",
  "ensure-store-hours-schema.cjs",
  "ensure-waitlist-schema.cjs",
  "ensure-partner-events-schema.cjs",
  "ensure-sound-category.cjs",
  "ensure-error-logs-schema.cjs",
  "ensure-order-item-vendor-column.cjs",
  "ensure-order-item-variation-columns.cjs",
  "ensure-vendor-order-column.cjs",
  "ensure-vendor-paystack-columns.cjs",
];

let failures = 0;
for (const script of checks) {
  console.log("Running runtime schema check: " + script);
  let result;
  let succeeded = false;

  // Neon can briefly close an idle/startup connection. Retry schema checks so
  // a transient database connection does not leave the production schema
  // partially upgraded (which can break otherwise healthy API requests).
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = spawnSync(process.execPath, [path.join(__dirname, script)], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    if (result.status === 0) {
      succeeded = true;
      break;
    }

    if (attempt < 3) {
      const delayMs = attempt * 1500;
      console.warn(
        "Runtime schema check failed for " + script +
        " (attempt " + attempt + "/3). Retrying in " + delayMs + "ms..."
      );
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, delayMs);
    }
  }

  if (!succeeded) {
    failures += 1;
    console.warn("Runtime schema check skipped after retries: " + script);
  }
}

if (failures > 0) {
  console.warn(
    "Runtime schema compatibility completed with " + failures +
      " failed check(s). The API will continue starting; database connectivity should be investigated separately."
  );
} else {
  console.log("All runtime schema compatibility checks completed successfully.");
}
