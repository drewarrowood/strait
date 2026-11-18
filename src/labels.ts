import type { IncidentKind, Source, Zone } from "./types";

export const ZONE_LABEL: Record<Zone, string> = {
  gulf: "Arabian Gulf",
  strait: "Strait of Hormuz",
  oman: "Gulf of Oman",
  yanbu: "Yanbu and the Red Sea",
  bab: "Bab al-Mandab",
};

export const ZONE_SHORT: Record<Zone, string> = {
  gulf: "Gulf",
  strait: "Strait",
  oman: "Oman",
  yanbu: "Yanbu",
  bab: "Bab",
};

export const SOURCE_LABEL: Record<Source, string> = {
  jmic: "Joint centre",
  ukmto: "Trade alert",
  state: "State-affiliated media",
  press: "Press relay",
  anon: "Anonymous official",
  liaison: "Liaison note",
};

export const SOURCE_HINT: Record<Source, string> = {
  jmic: "Slow, confirmed, and a few days behind the water. A weekly bulletin, not a live feed.",
  ukmto: "Fast and usually unconfirmed. Sometimes filed days after the event, and occasionally in the wrong place.",
  state: "Often early, often inflated, sometimes invented, sometimes true.",
  press: "Repeats other people's words. Watch for a running total printed as if it were today's count.",
  anon: "A single unnamed voice. Sometimes a real early hint, sometimes a rumor.",
  liaison: "A partner desk writing to you. Usually accurate about what it actually saw, and not comprehensive.",
};

export const KIND_LABEL: Record<IncidentKind, string> = {
  mine: "Mine contact",
  harassment: "Harassment",
  security: "Security incident",
  gnss: "GNSS interference",
  congestion: "Congestion mishap",
  pipeline: "Pipeline outage",
};

export function zoneName(zone: Zone | "unspecified"): string {
  if (zone === "unspecified") return "Unspecified waters";
  return ZONE_LABEL[zone];
}

export function dayLabel(day: number): string {
  if (day >= 1) return `day ${day}`;
  if (day === 0) return "the day before you took the desk";
  if (day === -1) return "two days before you took the desk";
  return "three days before you took the desk";
}

export function allegedLabel(day: number): string {
  if (day >= 1) return `Day ${day}`;
  if (day === 0) return "Day before the desk";
  if (day === -1) return "Two days before the desk";
  return "Three days before the desk";
}
