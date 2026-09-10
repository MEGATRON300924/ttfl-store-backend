import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";

let schemaReady = false;

async function ensureSchema() {
  if (schemaReady) return;
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS push_devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expo_push_token TEXT NOT NULL,
      platform TEXT NOT NULL,
      app_version TEXT,
      device_name TEXT,
      enabled BOOLEAN NOT NULL DEFAULT true,
      last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(user_id, expo_push_token)
    );
    CREATE INDEX IF NOT EXISTS push_devices_user_idx ON push_devices(user_id, enabled);
  `);
  schemaReady = true;
}

export async function registerDevice(userId: string, input: { expoPushToken: string; platform: string; appVersion?: string; deviceName?: string }) {
  await ensureSchema();
  const id = randomUUID();
  const rows = await prisma.$queryRawUnsafe<any[]>(
    `INSERT INTO push_devices (id,user_id,expo_push_token,platform,app_version,device_name,enabled,last_seen_at,created_at,updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,true,NOW(),NOW(),NOW())
     ON CONFLICT (user_id,expo_push_token) DO UPDATE SET platform=EXCLUDED.platform,app_version=EXCLUDED.app_version,device_name=EXCLUDED.device_name,enabled=true,last_seen_at=NOW(),updated_at=NOW()
     RETURNING id,"expo_push_token" AS "expoPushToken",platform,"app_version" AS "appVersion","device_name" AS "deviceName",enabled`,
    id,userId,input.expoPushToken,input.platform,input.appVersion ?? null,input.deviceName ?? null,
  );
  return rows[0];
}

export async function unregisterDevice(userId: string, expoPushToken: string) {
  await ensureSchema();
  await prisma.$executeRawUnsafe(`UPDATE push_devices SET enabled=false,updated_at=NOW() WHERE user_id=$1 AND expo_push_token=$2`, userId, expoPushToken);
}

export async function listDevices(userId: string) {
  await ensureSchema();
  return prisma.$queryRawUnsafe<any[]>(`SELECT id,expo_push_token AS "expoPushToken",platform,app_version AS "appVersion",device_name AS "deviceName",enabled,last_seen_at AS "lastSeenAt" FROM push_devices WHERE user_id=$1 ORDER BY last_seen_at DESC`, userId);
}

export async function sendPushToUser(userId: string, message: { title: string; body: string; data?: Record<string, unknown>; sound?: "default" | null }) {
  await ensureSchema();
  const devices = await prisma.$queryRawUnsafe<any[]>(`SELECT id,expo_push_token AS "expoPushToken" FROM push_devices WHERE user_id=$1 AND enabled=true`, userId);
  if (!devices.length) return { sent: 0 };

  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    title: message.title,
    body: message.body,
    data: message.data ?? {},
    sound: message.sound ?? "default",
  }));

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(messages),
  });

  if (!response.ok) throw new Error(`Expo push service returned ${response.status}`);
  const result = await response.json() as { data?: Array<{ status?: string; details?: { error?: string } }> };
  const tickets = result.data ?? [];
  for (let i = 0; i < tickets.length; i += 1) {
    if (tickets[i]?.details?.error === "DeviceNotRegistered") {
      await prisma.$executeRawUnsafe(`UPDATE push_devices SET enabled=false,updated_at=NOW() WHERE id=$1`, devices[i].id);
    }
  }
  return { sent: tickets.filter((ticket) => ticket.status === "ok").length, tickets };
}
