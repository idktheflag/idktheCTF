import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export const TIMEZONE_OPTIONS = [
  "UTC", "America/Anchorage", "America/Los_Angeles", "America/Denver",
  "America/Chicago", "America/New_York", "America/Toronto", "America/Caracas",
  "America/Sao_Paulo", "Atlantic/Reykjavik", "Europe/London", "Europe/Paris",
  "Europe/Berlin", "Europe/Athens", "Europe/Istanbul", "Africa/Cairo",
  "Africa/Johannesburg", "Asia/Jerusalem", "Asia/Dubai", "Asia/Karachi",
  "Asia/Kolkata", "Asia/Dhaka", "Asia/Bangkok", "Asia/Singapore",
  "Asia/Shanghai", "Asia/Tokyo", "Asia/Seoul", "Australia/Perth",
  "Australia/Sydney", "Pacific/Auckland",
];

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function getBackendURL() {
  return "";
}

export function localInputToUtc(value: string, timeZone: string) {
  if (!value) return null;
  const [date, time] = value.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute, second = 0] = time.split(":").map(Number);
  const includeSeconds = time.split(":").length > 2;
  const wallClock = Date.UTC(year, month - 1, day, hour, minute, second);
  let candidate = wallClock;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" }).formatToParts(candidate);
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    const rendered = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
    candidate -= rendered - candidate - (wallClock - candidate);
  }
  const result = new Date(candidate).toISOString();
  if (utcToLocalInput(result, timeZone, includeSeconds) !== value) throw new Error("This local time does not exist in the selected timezone. Choose a time outside the daylight-saving clock change.");
  return result;
}

export function utcToLocalInput(value: string | null, timeZone: string, includeSeconds = false) {
  if (!value) return "";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", ...(includeSeconds ? { second: "2-digit" as const } : {}), hourCycle: "h23" }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}${includeSeconds ? `:${values.second}` : ""}`;
}
