import type { Request, Response } from "express";
import { prisma } from "@/lib/prisma";
import { generateOpaqueToken, hashOpaqueToken } from "@/lib/tokens";
import { AppError } from "@/utils/app-error";
import * as authService from "./auth.service";

const HANDOFF_TTL_MS = 2 * 60 * 1000;

async function ensureHandoffTable() {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS auth_handoff_tokens (
      id TEXT PRIMARY KEY,
      token_hash TEXT NOT NULL UNIQUE,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      expires_at TIMESTAMPTZ NOT NULL,
      used_at TIMESTAMPTZ NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await prisma.$executeRawUnsafe(`CREATE INDEX IF NOT EXISTS auth_handoff_tokens_expires_idx ON auth_handoff_tokens (expires_at)`);
}

export async function createHandoff(req: Request, res: Response) {
  await ensureHandoffTable();
  const { raw, hash } = generateOpaqueToken();
  const id = generateOpaqueToken().hash;
  await prisma.$executeRawUnsafe(
    `INSERT INTO auth_handoff_tokens (id, token_hash, user_id, expires_at) VALUES ($1,$2,$3,$4)`,
    id, hash, req.user!.sub, new Date(Date.now() + HANDOFF_TTL_MS)
  );
  res.status(201).json({ token: raw, expiresIn: HANDOFF_TTL_MS / 1000 });
}

export async function exchangeHandoff(req: Request, res: Response) {
  await ensureHandoffTable();
  const token = typeof req.body?.token === "string" ? req.body.token : "";
  if (!token) throw AppError.badRequest("Handoff token is required", "HANDOFF_TOKEN_REQUIRED");
  const hash = hashOpaqueToken(token);
  const rows = await prisma.$queryRaw<Array<{ user_id: string }>>`
    UPDATE auth_handoff_tokens
    SET used_at = NOW()
    WHERE token_hash = ${hash}
      AND used_at IS NULL
      AND expires_at > NOW()
    RETURNING user_id
  `;
  if (!rows[0]) throw AppError.unauthorized("This sign-in handoff has expired or was already used", "HANDOFF_INVALID");
  const user = await prisma.user.findUnique({ where: { id: rows[0].user_id } });
  if (!user || user.status === "DELETED" || user.status === "SUSPENDED") throw AppError.unauthorized("Account is unavailable", "ACCOUNT_UNAVAILABLE");
  const { accessToken, refreshToken } = await authService.issueSession(user, {
    userAgent: req.headers["user-agent"],
    ipAddress: req.ip,
  });
  const { passwordHash, ...safeUser } = user;
  res.status(200).json({ user: safeUser, accessToken, refreshToken });
}
