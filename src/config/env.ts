import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  nodeEnv: process.env.NODE_ENV ?? "development",
  isProd: process.env.NODE_ENV === "production",
  port: Number(process.env.PORT ?? 4000),
  appUrl: process.env.APP_URL ?? "http://localhost:3000",

  databaseUrl: required("DATABASE_URL"),

  jwt: {
    accessSecret: required("JWT_ACCESS_SECRET"),
    refreshSecret: required("JWT_REFRESH_SECRET"),
    accessTtl: process.env.JWT_ACCESS_TTL ?? "15m",
    refreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
  },

  cookies: {
    domain: process.env.COOKIE_DOMAIN || undefined,
    crossSite: process.env.COOKIE_CROSS_SITE === "true",
  },

  corsOrigin: process.env.CORS_ORIGIN ?? "http://localhost:3000",

  email: {
    from: process.env.EMAIL_FROM ?? "TTFL Store <no-reply@thetronforge.com>",
    provider: process.env.EMAIL_PROVIDER ?? "console",
  },
  adminNotificationEmail: process.env.ADMIN_NOTIFICATION_EMAIL,

  whatsapp: {
    apiToken: process.env.WHATSAPP_API_TOKEN,
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    adminNumber: process.env.WHATSAPP_ADMIN_NUMBER,
  },

  authRateLimit: {
    max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 10),
    windowMin: Number(process.env.AUTH_RATE_LIMIT_WINDOW_MIN ?? 15),
  },

  paystackSecretKey: process.env.PAYSTACK_SECRET_KEY,
};
