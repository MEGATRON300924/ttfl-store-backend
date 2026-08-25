/**
 * Deliberately minimal — a few substring checks cover the vast majority
 * of real traffic without pulling in a full UA-parsing library for one
 * field. Good enough for "mobile vs desktop vs tablet" analytics
 * breakdowns; not meant for precise device/browser fingerprinting.
 */
export function detectDeviceType(userAgent: string | undefined | null): "mobile" | "tablet" | "desktop" | "unknown" {
  if (!userAgent) return "unknown";
  const ua = userAgent.toLowerCase();
  if (/ipad|tablet(?!.*mobile)/.test(ua)) return "tablet";
  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini/.test(ua)) return "mobile";
  if (/android/.test(ua)) return "tablet"; // Android without "Mobile" token is typically a tablet
  return "desktop";
}
