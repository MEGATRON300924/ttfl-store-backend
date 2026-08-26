/**
 * Dev-only email test. Runs the SAME adapter production uses
 * (lib/email-adapter.ts), so a successful run here means Resend (or
 * whichever EMAIL_PROVIDER is set) is actually configured correctly —
 * not a simulation.
 *
 * This is a CLI script, not an HTTP route. It is never imported by
 * app.ts or any router, so there is no way to trigger it over the
 * network — satisfies "never create an unauthenticated public
 * email-sending endpoint."
 *
 * Usage:
 *   npm run test:email -- --to=you@example.com
 */
import "dotenv/config";
import { deliverEmail } from "@/lib/email-adapter";
import { renderEmailLayout } from "@/lib/email-layout";
import { env } from "@/config/env";

function getArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const match = process.argv.find((a) => a.startsWith(prefix));
  return match?.slice(prefix.length);
}

async function main() {
  const to = getArg("to");
  if (!to) {
    console.error("Usage: npm run test:email -- --to=you@example.com");
    process.exit(1);
  }

  console.log(`Provider: ${env.email.provider}`);
  console.log(`Sending test email to: ${to}`);

  const result = await deliverEmail({
    to,
    subject: "TTFL Store — test email",
    html: renderEmailLayout({
      heading: "Test email",
      bodyHtml: `<p>If you're reading this, your <strong>${env.email.provider}</strong> email delivery is configured correctly.</p><p>This was sent by <code>npm run test:email</code> and is not a real notification.</p>`,
    }),
  });

  if (result.ok) {
    console.log("✅ Sent successfully.");
    process.exit(0);
  } else {
    console.error(`❌ Failed: ${result.error}`);
    process.exit(1);
  }
}

void main();
