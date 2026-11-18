import { CONFIG } from "./config";
import { clamp, clampInt } from "./rng";
import type { ConvoySize, Decisions, Guidance, PublicMessage } from "./types";

const CONVOYS: readonly ConvoySize[] = [2, 4, 8, 12];
const GUIDANCE: readonly Guidance[] = ["sail", "caution", "defer"];
const MESSAGES: readonly PublicMessage[] = ["reassure", "factual", "warn", "silent"];

export const BASELINE: Decisions = {
  escortStrait: 3,
  escortOman: 1,
  escortBab: 1,
  convoySize: 4,
  mcmStrait: 2,
  mcmOman: 0,
  mcmBab: 1,
  straitAttemptShips: 6,
  fujairahMb: 1.2,
  yanbuMb: 2.5,
  yanbuSouthShare: 0.35,
  guidance: "caution",
  message: "factual",
};

/** Few ships, small convoys, bypasses open, only escorted hulls moving. */
export const CAUTIOUS: Decisions = {
  escortStrait: 3,
  escortOman: 1,
  escortBab: 2,
  convoySize: 2,
  mcmStrait: 2,
  mcmOman: 0,
  mcmBab: 1,
  straitAttemptShips: 3,
  fujairahMb: 1.8,
  yanbuMb: 4,
  yanbuSouthShare: 0.15,
  guidance: "defer",
  message: "factual",
};

/** Everyone through the Strait, unescorted, in one large convoy, no sweepers, no bypass. */
export const RECKLESS: Decisions = {
  escortStrait: 0,
  escortOman: 0,
  escortBab: 0,
  convoySize: 12,
  mcmStrait: 0,
  mcmOman: 0,
  mcmBab: 0,
  straitAttemptShips: 8,
  fujairahMb: 0,
  yanbuMb: 0,
  yanbuSouthShare: 0,
  guidance: "sail",
  message: "reassure",
};

/** Same traffic as the baseline, but no mine clearance at all. */
export const UNSWEPT: Decisions = {
  ...BASELINE,
  mcmStrait: 0,
  mcmOman: 0,
  mcmBab: 0,
};

function shave(a: number, b: number, c: number, pool: number): [number, number, number] {
  let x = a;
  let y = b;
  let z = c;
  while (x + y + z > pool) {
    if (x >= y && x >= z && x > 0) x -= 1;
    else if (y >= z && y > 0) y -= 1;
    else if (z > 0) z -= 1;
    else break;
  }
  return [x, y, z];
}

export function sanitizeDecision(input: Decisions): Decisions {
  const convoy = CONVOYS.includes(input.convoySize) ? input.convoySize : 4;
  const guidance = GUIDANCE.includes(input.guidance) ? input.guidance : "caution";
  const message = MESSAGES.includes(input.message) ? input.message : "factual";
  const [escortStrait, escortOman, escortBab] = shave(
    clampInt(input.escortStrait, 0, CONFIG.escortPool),
    clampInt(input.escortOman, 0, CONFIG.escortPool),
    clampInt(input.escortBab, 0, CONFIG.escortPool),
    CONFIG.escortPool,
  );
  const [mcmStrait, mcmOman, mcmBab] = shave(
    clampInt(input.mcmStrait, 0, CONFIG.mcmPool),
    clampInt(input.mcmOman, 0, CONFIG.mcmPool),
    clampInt(input.mcmBab, 0, CONFIG.mcmPool),
    CONFIG.mcmPool,
  );
  return {
    escortStrait,
    escortOman,
    escortBab,
    convoySize: convoy,
    mcmStrait,
    mcmOman,
    mcmBab,
    straitAttemptShips: clampInt(input.straitAttemptShips, 0, CONFIG.maxProgrammeShips),
    fujairahMb: clamp(input.fujairahMb, 0, CONFIG.fujairahCapacityMb),
    yanbuMb: clamp(input.yanbuMb, 0, CONFIG.yanbuCapacityMb),
    yanbuSouthShare: clamp(input.yanbuSouthShare, 0, 1),
    guidance,
    message,
  };
}

export function reserveEscorts(d: Decisions): number {
  return CONFIG.escortPool - d.escortStrait - d.escortOman - d.escortBab;
}

export function reserveMcm(d: Decisions): number {
  return CONFIG.mcmPool - d.mcmStrait - d.mcmOman - d.mcmBab;
}

export function describePlan(d: Decisions): string {
  const south = Math.round(d.yanbuSouthShare * 100);
  const reserve = reserveEscorts(d);
  const stood = reserveMcm(d);
  const slots = d.escortStrait * CONFIG.shipsPerEscort;
  return `Call ${d.straitAttemptShips} programme ships through the Strait in convoys of at most ${d.convoySize}, with ${d.escortStrait} escorts there (${slots} ship-slots, your ships first). Oman ${d.escortOman}, Bab al-Mandab ${d.escortBab}, reserve ${reserve}. Sweepers: Strait ${d.mcmStrait}, Oman ${d.mcmOman}, Bab ${d.mcmBab}, stood down ${stood}. Fujairah ${d.fujairahMb.toFixed(1)} mb/d, Yanbu ${d.yanbuMb.toFixed(1)} mb/d of which ${south}% sails south through Bab al-Mandab and the rest goes north via Suez. Guidance to owners: ${guidanceLabel(d.guidance)}. Public line: ${messageLabel(d.message)}.`;
}

export function guidanceLabel(g: Guidance): string {
  if (g === "sail") return "sail as planned";
  if (g === "caution") return "heightened caution";
  return "defer unescorted sailings";
}

export function messageLabel(m: PublicMessage): string {
  if (m === "reassure") return "reassure the market";
  if (m === "factual") return "factual, no forecast in the line";
  if (m === "warn") return "warn of elevated risk";
  return "decline to comment";
}

export function cloneDecision(d: Decisions): Decisions {
  return { ...d };
}
