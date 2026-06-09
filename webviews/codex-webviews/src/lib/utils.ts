import clsx, { type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Human-readable byte size, e.g. 245 MB / 1.4 GB. Returns "" for unknown/zero.
 * Uses decimal units (base-1000) to match what file managers (macOS Finder,
 * most "Get Info" dialogs) report, so an 840 MB file reads as ~840 MB rather
 * than ~802 MiB.
 */
export function formatBytes(bytes?: number | null): string {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
    return ""
  }
  const units = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1000)))
  const value = bytes / Math.pow(1000, i)
  const rounded = value >= 100 || i === 0 ? Math.round(value) : Math.round(value * 10) / 10
  return `${rounded} ${units[i]}`
}
