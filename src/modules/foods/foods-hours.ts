export type FoodBusinessHour = {
  dayOfWeek: number;
  isOpen: boolean;
  openTime: string | null;
  closeTime: string | null;
};

function minutes(value: string | null): number | null {
  if (!value) return null;
  const match = value.match(/^(\\d{2}):(\\d{2})/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Uses Africa/Lagos local time. Existing restaurants without configured hours
 * remain orderable; once a vendor configures at least one open day, closed
 * days and out-of-window orders are rejected at checkout.
 */
export function isWithinConfiguredHours(
  hours: FoodBusinessHour[],
  now: Date = new Date(),
): boolean {
  if (!hours.some((hour) => hour.isOpen)) return true;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const dayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const day = dayMap[values.weekday];
  const current = Number(values.hour) * 60 + Number(values.minute);
  if (day === undefined || !Number.isFinite(current)) return false;

  const today = hours.find((hour) => hour.dayOfWeek === day);
  if (today?.isOpen) {
    const open = minutes(today.openTime);
    const close = minutes(today.closeTime);
    if (open === null || close === null) return false;
    if (close > open && current >= open && current < close) return true;
    if (close <= open && current >= open) return true;
  }

  const previousDay = (day + 6) % 7;
  const previous = hours.find((hour) => hour.dayOfWeek === previousDay);
  if (previous?.isOpen) {
    const open = minutes(previous.openTime);
    const close = minutes(previous.closeTime);
    if (open !== null && close !== null && close <= open && current < close) return true;
  }

  return false;
}
