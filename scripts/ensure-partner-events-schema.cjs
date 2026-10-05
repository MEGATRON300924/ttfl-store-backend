const { execFileSync } = require("node:child_process");
const path = require("node:path");

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
const prismaBin = path.join(process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "prisma.cmd" : "prisma");

const sql = `
DO $$ BEGIN CREATE TYPE "PartnerStatus" AS ENUM ('PENDING','APPROVED','SUSPENDED','REJECTED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EventAudience" AS ENUM ('VENDORS','CUSTOMERS','EVERYONE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "EventStatus" AS ENUM ('DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','CANCELLED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE "PartnerEventPlan" AS ENUM ('FREE','FEATURED','PREMIUM','ENTERPRISE'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE TABLE IF NOT EXISTS partners (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  organization_name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT,
  logo_url TEXT,
  website_url TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  status TEXT NOT NULL DEFAULT 'PENDING',
  event_plan TEXT NOT NULL DEFAULT 'FREE',
  complimentary_access BOOLEAN NOT NULL DEFAULT false,
  complimentary_access_expires_at TIMESTAMPTZ,
  complimentary_access_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS partners_status_idx ON partners(status);
CREATE INDEX IF NOT EXISTS partners_event_plan_idx ON partners(event_plan);

CREATE TABLE IF NOT EXISTS partner_events (
  id TEXT PRIMARY KEY,
  partner_id TEXT NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  description TEXT NOT NULL,
  cover_image_url TEXT,
  video_url TEXT,
  audience TEXT NOT NULL DEFAULT 'EVERYONE',
  status TEXT NOT NULL DEFAULT 'PENDING_REVIEW',
  event_plan TEXT NOT NULL DEFAULT 'FREE',
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ,
  registration_deadline TIMESTAMPTZ,
  event_type TEXT NOT NULL DEFAULT 'Virtual',
  location TEXT,
  registration_url TEXT,
  organizer_name TEXT,
  organizer_email TEXT,
  organizer_phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_at TIMESTAMPTZ
);

ALTER TABLE partner_events ADD COLUMN IF NOT EXISTS video_url TEXT;

CREATE INDEX IF NOT EXISTS partner_events_partner_id_idx ON partner_events(partner_id);
CREATE INDEX IF NOT EXISTS partner_events_status_idx ON partner_events(status);
CREATE INDEX IF NOT EXISTS partner_events_audience_idx ON partner_events(audience);
CREATE INDEX IF NOT EXISTS partner_events_starts_at_idx ON partner_events(starts_at);

-- The bootstrap tables were originally created with TEXT columns. PostgreSQL
-- will not always cast a TEXT default while changing the column type, so remove
-- the defaults first, convert the existing values, then restore enum defaults.
ALTER TABLE partners ALTER COLUMN status DROP DEFAULT;
ALTER TABLE partners ALTER COLUMN event_plan DROP DEFAULT;
ALTER TABLE partner_events ALTER COLUMN audience DROP DEFAULT;
ALTER TABLE partner_events ALTER COLUMN status DROP DEFAULT;
ALTER TABLE partner_events ALTER COLUMN event_plan DROP DEFAULT;

ALTER TABLE partners ALTER COLUMN status TYPE "PartnerStatus" USING status::"PartnerStatus";
ALTER TABLE partners ALTER COLUMN event_plan TYPE "PartnerEventPlan" USING event_plan::"PartnerEventPlan";
ALTER TABLE partner_events ALTER COLUMN audience TYPE "EventAudience" USING audience::"EventAudience";
ALTER TABLE partner_events ALTER COLUMN status TYPE "EventStatus" USING status::"EventStatus";
ALTER TABLE partner_events ALTER COLUMN event_plan TYPE "PartnerEventPlan" USING event_plan::"PartnerEventPlan";

ALTER TABLE partners ALTER COLUMN status SET DEFAULT 'PENDING'::"PartnerStatus";
ALTER TABLE partners ALTER COLUMN event_plan SET DEFAULT 'FREE'::"PartnerEventPlan";
ALTER TABLE partner_events ALTER COLUMN audience SET DEFAULT 'EVERYONE'::"EventAudience";
ALTER TABLE partner_events ALTER COLUMN status SET DEFAULT 'PENDING_REVIEW'::"EventStatus";
ALTER TABLE partner_events ALTER COLUMN event_plan SET DEFAULT 'FREE'::"PartnerEventPlan";
`;

execFileSync(prismaBin, ["db", "execute", "--stdin", "--schema", schemaPath], {
  input: sql,
  stdio: ["pipe", "inherit", "inherit"],
});
console.log("Partner and event tables ensured.");
