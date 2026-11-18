export interface Band {
  low: number;
  median: number;
  high: number;
}

export function oneDecimal(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return (Math.round(n * 10) / 10).toFixed(1);
}

export function whole(n: number): string {
  if (!Number.isFinite(n)) return "–";
  return String(Math.round(n));
}

export function signed(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "–";
  const v = digits === 0 ? Math.round(n) : Math.round(n * 10) / 10;
  const text = digits === 0 ? String(v) : v.toFixed(1);
  return v > 0 ? `+${text}` : text;
}

export function percent(p: number): string {
  if (!Number.isFinite(p)) return "–";
  return `${Math.round(p * 100)}%`;
}

/** Median and 5th–95th, never a bare point estimate. */
export function bandText(band: Band, fmt: (n: number) => string = oneDecimal): string {
  return `median ${fmt(band.median)} · 5th–95th ${fmt(band.low)}–${fmt(band.high)}`;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function pressureWord(pressure: number): string {
  if (pressure < 20) return "quiet";
  if (pressure < 40) return "restless";
  if (pressure < 60) return "heated";
  if (pressure < 80) return "severe";
  return "acute";
}

export function judgmentWord(score: number): string {
  if (score >= 80) return "Sound judgment";
  if (score >= 65) return "Mostly sound";
  if (score >= 50) return "Mixed";
  if (score >= 25) return "Weak";
  return "The books and the odds were mishandled";
}
