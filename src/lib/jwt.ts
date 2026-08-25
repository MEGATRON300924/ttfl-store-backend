import jwt from "jsonwebtoken";
import { env } from "@/config/env";
import type { Role } from "@prisma/client";

export type AccessTokenPayload = {
  sub: string; // user id
  role: Role;
  emailVerified: boolean;
};

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.jwt.accessSecret, {
    expiresIn: env.jwt.accessTtl as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.jwt.accessSecret) as AccessTokenPayload;
}
