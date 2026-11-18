// Damage signatures. A hit is shown as what a crew can see, not as a weapon.
//
// Mines act below the waterline: flooding, list, settling by the bow or stern,
// sometimes keel damage, and often little or no fire. They never produce an
// above-waterline-only signature.
//
// One-way drones and anti-ship missiles act above the waterline: fire, smoke,
// a hole above the waterline, or superstructure and bridge damage. Flooding,
// when it happens, is limited.
//
// The engine room and the steering gear sit aft and low. A cable that names
// only that compartment does not locate the breach. It says so, and both a
// below-waterline hit and an above-waterline hit stay plausible.

import { CONFIG } from "./config";
import { dayLabel, zoneName } from "./labels";
import { clamp, rngFor, type Rng } from "./rng";
import type {
  CallConfidence,
  CasualtyRisk,
  DamageAmbiguity,
  DamageAssessment,
  DamageCompartment,
  EvidenceReport,
  IncidentKind,
  Report,
  Settling,
  ShipCondition,
  Source,
  TrueEvent,
  WeaponCall,
  WeaponClass,
  WeaponTag,
  Zone,
} from "./types";

const MINE_COMPARTMENTS: readonly DamageCompartment[] = [
  "forepeak",
  "forward-hold",
  "midships",
  "engine-room",
  "steering-gear",
];

const DRONE_COMPARTMENTS: readonly DamageCompartment[] = [
  "superstructure",
  "bridge",
  "hull-side",
  "hull-side",
  "engine-room",
  "steering-gear",
];

const MISSILE_COMPARTMENTS: readonly DamageCompartment[] = [
  "hull-side",
  "hull-side",
  "hull-side",
  "superstructure",
  "bridge",
  "engine-room",
  "steering-gear",
];

export function isAftLow(compartment: DamageCompartment): compartment is "engine-room" | "steering-gear" {
  return compartment === "engine-room" || compartment === "steering-gear";
}

/** Above-waterline observations with none of the below-waterline ones. */
export function isAboveWaterlineOnly(report: EvidenceReport): boolean {
  if (report.compartmentOnly || report.heightOfBreach !== "above") return false;
  if (report.flooding || report.list || report.settling !== "none" || report.keelDamage) return false;
  return (
    report.fire ||
    report.smoke ||
    report.holeAboveWaterline ||
    report.superstructureDamage ||
    report.bridgeDamage ||
    report.localizedImpact ||
    report.heavyBlast
  );
}

export function factsAreAboveWaterlineOnly(facts: {
  flooding: boolean;
  list: boolean;
  settling: Settling;
  keelDamage: boolean;
  fire: boolean;
  smoke: boolean;
  holeAboveWaterline: boolean;
  superstructureDamage: boolean;
  bridgeDamage: boolean;
  localizedImpact: boolean;
  heavyBlast: boolean;
}): boolean {
  const below = facts.flooding || facts.list || facts.settling !== "none" || facts.keelDamage;
  if (below) return false;
  return (
    facts.fire ||
    facts.smoke ||
    facts.holeAboveWaterline ||
    facts.superstructureDamage ||
    facts.bridgeDamage ||
    facts.localizedImpact ||
    facts.heavyBlast
  );
}

/**
 * A cable that names only the engine room or the steering gear.
 * The height line is always unresolved, including when the prose says "fire".
 */
export function makeCompartmentOnlyReport(
  compartment: "engine-room" | "steering-gear",
  stage: "early" | "full",
  symptom: "fire" | "damaged" = "damaged",
): EvidenceReport {
  const lead = stage === "early" ? "Initial report, incomplete." : "Follow-up survey.";
  const what =
    compartment === "engine-room"
      ? symptom === "fire"
        ? "Engine room fire is the report."
        : "The engine room is reported damaged."
      : symptom === "fire"
        ? "Steering gear fire is the report."
        : "Steering gear damaged.";
  const pending = stage === "early" ? " Some of the damage is not in this cable yet." : "";
  const text = `${lead} ${what} Height of breach unknown. The cable does not establish whether the damage is above or below the waterline, so both a below-waterline hit and an above-waterline hit stay plausible.${pending}`;
  return {
    stage,
    heightOfBreach: "unknown",
    ambiguity: "height",
    compartmentOnly: true,
    compartment,
    flooding: false,
    list: false,
    settling: "none",
    keelDamage: false,
    fire: false,
    smoke: false,
    holeAboveWaterline: false,
    superstructureDamage: false,
    bridgeDamage: false,
    localizedImpact: false,
    heavyBlast: false,
    text,
  };
}

/** Hidden class for a damaging hit. Mines stay mines. Security splits into drone or missile. */
export function assessHit(seed: string, eventId: string, kind: "mine" | "security"): DamageAssessment {
  const rng = rngFor(seed, `damage|${eventId}`);
  const weapon: WeaponClass = kind === "mine" ? "mine" : rng() < CONFIG.damage.droneGivenSecurity ? "drone" : "missile";
  return assessWeapon(weapon, rng);
}

/** Same generator the campaign uses, fed by a caller-owned stream. For tests. */
export function assessWeapon(weapon: WeaponClass, rng: Rng): DamageAssessment {
  const facts = generateFacts(weapon, rng);
  const aft = isAftLow(facts.compartment);
  const earlyOnly = aft && rng() < CONFIG.damage.compartmentOnlyP;
  const fullOnly = earlyOnly && rng() < CONFIG.damage.compartmentOnlyStaysP;
  const early = projectReport(weapon, facts, "early", rng, earlyOnly);
  const full = projectReport(weapon, facts, "full", rng, fullOnly);
  if (weapon === "mine" && (factsAreAboveWaterlineOnly(facts) || isAboveWaterlineOnly(early) || isAboveWaterlineOnly(full))) {
    throw new Error("A mine produced an above-waterline-only signature.");
  }
  const condition = rollCondition(weapon, facts, rng);
  const casualtyRisk = riskFor(facts, condition);
  return { ...facts, weapon, condition, casualtyRisk, early, full };
}

export function stageFor(eventDay: number, morningOrFiledDay: number): "hidden" | "early" | "full" {
  const earlyDay = clampDay(eventDay + 1);
  const fullDay = clampDay(eventDay + CONFIG.damage.fullLatency);
  if (morningOrFiledDay < earlyDay) return "hidden";
  if (morningOrFiledDay >= fullDay) return "full";
  return "early";
}

export function visibleEvidence(assessment: DamageAssessment, eventDay: number, morningDay: number): EvidenceReport | null {
  const stage = stageFor(eventDay, morningDay);
  if (stage === "hidden") return null;
  return stage === "full" ? assessment.full : assessment.early;
}

export interface CrewLine {
  casualties: number;
  missing: number;
}

/** Evidence plus the operational state. Still no weapon name. */
export function playerCable(assessment: DamageAssessment, report: EvidenceReport, crew: CrewLine | null): string {
  const crewLine =
    crew == null
      ? ""
      : crew.casualties > 0
        ? ` Crew casualties: ${crew.casualties}.${crew.missing > 0 ? ` Of those, missing: ${crew.missing}.` : ""}`
        : " Crew accounted for.";
  return `${report.text} ${conditionSentence(assessment.condition)} ${riskSentence(assessment.casualtyRisk)}${crewLine}`;
}

export function conditionSentence(condition: ShipCondition): string {
  switch (condition) {
    case "total_loss":
      return "The ship is a total loss.";
    case "disabled":
      return "The ship is disabled and cannot steam.";
    case "under_tow":
      return "The ship is under tow.";
    case "proceed_slow":
      return "The ship can proceed, slowly.";
  }
}

export function conditionShort(condition: ShipCondition): string {
  switch (condition) {
    case "total_loss":
      return "total loss";
    case "disabled":
      return "disabled";
    case "under_tow":
      return "under tow";
    case "proceed_slow":
      return "proceeding slowly";
  }
}

export function weaponLabel(weapon: WeaponClass): string {
  switch (weapon) {
    case "mine":
      return "Mine";
    case "drone":
      return "One-way attack drone";
    case "missile":
      return "Anti-ship missile";
  }
}

export function callLabel(call: WeaponCall): string {
  if (call === "unknown") return "Unknown";
  return weaponLabel(call);
}

function riskSentence(risk: CasualtyRisk): string {
  switch (risk) {
    case "low":
      return "Crew casualty risk from this damage is low.";
    case "elevated":
      return "Crew casualty risk from this damage is elevated.";
    case "high":
      return "Crew casualty risk from this damage is high.";
  }
}

export interface LaneRecovery {
  /** Cargo that still moves because a damaged ship can proceed slowly. */
  flowBackMb: number;
  /** Damaged programme hulls that are disabled or under tow and can wait again. */
  anchorReturns: number;
}

/** Play effect of the post-hit state. Total losses stay out. This does not change who was hit. */
export function recoveryFor(events: readonly TrueEvent[]): LaneRecovery {
  let flowBackMb = 0;
  let anchorReturns = 0;
  for (const event of events) {
    const damage = event.damage;
    if (!damage || event.shipsDamaged <= 0) continue;
    if (damage.condition === "proceed_slow") {
      flowBackMb += event.shipsDamaged * CONFIG.shipMb * CONFIG.damage.slowDeliveryFraction;
    }
    if (damage.condition === "disabled" || damage.condition === "under_tow") {
      anchorReturns += event.shipsDamaged;
    }
  }
  return { flowBackMb, anchorReturns };
}

export interface DispatchInput {
  source: Source;
  zone: Zone | "unspecified";
  claimed: number;
  allegedDay: number;
  late: boolean;
  variant: number;
  cable: string;
}

/** Source voice around a damage cable. The cable is quoted, not reclassified. */
export function damageDispatch(input: DispatchInput): string {
  const where = zoneName(input.zone);
  const when = dayLabel(input.allegedDay);
  const v = Math.abs(input.variant) % 3;
  const late = input.late ? ` Filed today, concerning ${when}.` : "";
  const n = input.claimed === 1 ? "one ship" : `${input.claimed} ships`;
  const leads: Record<Source, string[]> = {
    ukmto: [
      `Trade-operations alert, unconfirmed. Hull damage reported in the ${where}, involving ${n}. Masters have not all been reached.${late}`,
      `Unconfirmed trade alert from the ${where}: hull damage affecting ${n}. The alert is not a confirmation.${late}`,
      `Trade desk passes an unconfirmed damage report from the ${where}. Claimed figure: ${input.claimed}. Treat the place and the count as unchecked.${late}`,
    ],
    liaison: [
      `Liaison note for the cell. Hull damage in the ${where}, ${when}. Ships in the note: ${input.claimed}.`,
      `Partner desk writes that it has hull damage in the ${where} on ${when}. Figure in the note: ${input.claimed}.`,
      `Liaison, terse: hull damage, ${where}, ${when}. Count they will stand behind: ${input.claimed}.`,
    ],
    state: [
      `State-affiliated outlet claims ${n} were hit in the ${where}. The dispatch includes no evidence a desk can check beyond the cable below.`,
      `A state-affiliated channel says ${input.claimed} merchant ships were hit in the ${where} on ${when}. The wording is definite. The sourcing is not.`,
      `State-affiliated media: "${input.claimed} tankers hit in the ${where}." The claim is not matched, in the copy, to named ships.`,
    ],
    press: [
      `Press relay of an earlier damage cable from the ${where}, figure ${input.claimed}. The copy adds no new observation.`,
      `A wire repeats a damage report already in circulation about the ${where} (claimed ${input.claimed}). Nothing in the paragraph is a fresh survey.`,
      `News brief, citing "maritime sources," retells a damage report from the ${where}. Claimed figure ${input.claimed}. This is a second telling, not a second hit.`,
    ],
    jmic: [
      `Joint centre bulletin. Hull damage in the ${where} on ${when}. Incidents accepted in this item: ${input.claimed}. Events from the last day of the window are still in processing and are not in this bulletin.`,
      `Joint centre, confirmed. Hull damage, ${where}, ${when}. Count in the bulletin: ${input.claimed}.`,
      `Official joint bulletin accepts one damage item in the ${where} on ${when}. Figure: ${input.claimed}. Later filings can still revise a quiet week.`,
    ],
    anon: [
      `A reporter quotes an anonymous official who says a ship was hit near the ${where}. No named ship, no time more precise than ${when}, claimed figure ${input.claimed}.`,
      `Anonymous official, via a reporter: hull damage in connection with the ${where}. The story still prints ${input.claimed}.`,
      `An unnamed official tells the press of hull damage "in the region of the ${where}." The quote is thin. Claimed figure: ${input.claimed}.`,
    ],
  };
  return `${leads[input.source][v]} ${input.cable}`;
}

export function damageRestatement(originalText: string, variant: number): string {
  const v = Math.abs(variant) % 3;
  const leads = [
    "Press relay of an earlier damage cable. The copy adds no new observation.",
    "A wire repeats a damage report already in circulation. Nothing in the paragraph is a fresh survey.",
    "News brief retells a damage cable. This is a second telling, not a second hit.",
  ];
  return `${leads[v]} ${originalText}`;
}

export interface WeaponCallScore {
  raw: number;
  note: string;
}

/**
 * Calibrated call. Correct is positive and rises with confidence. A wrong call
 * is negative and a confident one costs more. Unknown on ambiguous evidence is
 * exactly zero.
 */
export function scoreWeaponCall(input: {
  weapon: WeaponClass;
  call: WeaponCall;
  confidence: CallConfidence;
  ambiguity: DamageAmbiguity;
}): WeaponCallScore {
  const score = CONFIG.damage;
  if (input.call === "unknown") {
    if (input.ambiguity === "none") {
      return { raw: score.scoreUnknownClear, note: "Unknown. The cable was specific enough to name a class." };
    }
    if (input.ambiguity === "height") {
      return {
        raw: score.scoreUnknownAmbiguous,
        note: "Unknown. The cable leaves the height of the breach unresolved, so this call is not penalized.",
      };
    }
    return {
      raw: score.scoreUnknownAmbiguous,
      note: "Unknown. The cable does not separate the above-waterline classes, so this call is not penalized.",
    };
  }
  const correct = input.call === input.weapon;
  const raw = correct
    ? input.confidence === "high"
      ? score.scoreCorrectHigh
      : input.confidence === "medium"
        ? score.scoreCorrectMedium
        : score.scoreCorrectLow
    : input.confidence === "high"
      ? score.scoreWrongHigh
      : input.confidence === "medium"
        ? score.scoreWrongMedium
        : score.scoreWrongLow;
  if (correct) {
    const hedge =
      input.ambiguity === "none" ? "" : " The cable did not force it; a confident miss would have cost more.";
    return { raw, note: `Correct.${hedge}` };
  }
  const sting = input.confidence === "high" ? " The confidence was high, so the miss costs more." : "";
  const limit =
    input.ambiguity === "none" ? "" : " Unknown would not have been penalized on this cable.";
  return { raw, note: `Wrong.${sting}${limit}` };
}

export function scaleDamageScore(raws: readonly number[]): number | null {
  if (raws.length === 0) return null;
  const mean = raws.reduce((sum, value) => sum + value, 0) / raws.length;
  const worst = CONFIG.damage.scoreWrongHigh;
  const best = CONFIG.damage.scoreCorrectHigh;
  const span = best - worst;
  if (!(span > 0)) return null;
  return clamp(((mean - worst) / span) * 100, 0, 100);
}

export interface DamageGradeRow {
  eventId: string;
  day: number;
  zone: Zone;
  weapon: WeaponClass;
  call: WeaponCall;
  confidence: CallConfidence | null;
  ambiguity: DamageAmbiguity;
  raw: number;
  note: string;
  evidence: string;
}

export interface DamageGrade {
  points: number | null;
  rows: DamageGradeRow[];
  correct: number;
  wrong: number;
  unknown: number;
}

/** Score every damage cable the desk was shown by `morningDay`. Untagged calls count as unknown. */
export function gradeDamageCalls(
  events: readonly TrueEvent[],
  reports: readonly Report[],
  tags: Readonly<Record<string, WeaponTag>>,
  morningDay: number,
): DamageGrade {
  const revealed = new Set<string>();
  for (const report of reports) {
    if (report.filedDay > morningDay || report.filedDay < 1 || report.truth.fabricated) continue;
    for (const id of report.truth.realEventIds) revealed.add(id);
  }
  const rows: DamageGradeRow[] = [];
  for (const event of events) {
    if (!event.damage) continue;
    if (!event.programme && !revealed.has(event.id)) continue;
    const evidence = visibleEvidence(event.damage, event.day, morningDay);
    if (!evidence) continue;
    const tag = tags[event.id];
    const call: WeaponCall = tag?.call ?? "unknown";
    const confidence = call === "unknown" ? null : (tag?.confidence ?? "medium");
    const scored = scoreWeaponCall({
      weapon: event.damage.weapon,
      call,
      confidence: confidence ?? "medium",
      ambiguity: evidence.ambiguity,
    });
    rows.push({
      eventId: event.id,
      day: event.day,
      zone: event.zone,
      weapon: event.damage.weapon,
      call,
      confidence,
      ambiguity: evidence.ambiguity,
      raw: scored.raw,
      note: scored.note,
      evidence: evidence.text,
    });
  }
  rows.sort((a, b) => a.day - b.day || (a.eventId < b.eventId ? -1 : 1));
  let correct = 0;
  let wrong = 0;
  let unknown = 0;
  for (const row of rows) {
    if (row.call === "unknown") unknown += 1;
    else if (row.call === row.weapon) correct += 1;
    else wrong += 1;
  }
  return {
    points: scaleDamageScore(rows.map((row) => row.raw)),
    rows,
    correct,
    wrong,
    unknown,
  };
}

export function sanitizeWeaponTags(raw: unknown): Record<string, WeaponTag> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, WeaponTag> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!value || typeof value !== "object") continue;
    const call = (value as { call?: unknown }).call;
    const confidence = (value as { confidence?: unknown }).confidence;
    if (call !== "mine" && call !== "drone" && call !== "missile" && call !== "unknown") continue;
    const conf: CallConfidence = confidence === "low" || confidence === "high" || confidence === "medium" ? confidence : "medium";
    out[key] = { eventId: key, call, confidence: conf };
  }
  return out;
}

export function damagingKind(kind: IncidentKind): kind is "mine" | "security" {
  return kind === "mine" || kind === "security";
}

interface FactDraw {
  flooding: boolean;
  list: boolean;
  settling: Settling;
  keelDamage: boolean;
  fire: boolean;
  smoke: boolean;
  holeAboveWaterline: boolean;
  superstructureDamage: boolean;
  bridgeDamage: boolean;
  localizedImpact: boolean;
  heavyBlast: boolean;
  compartment: DamageCompartment;
}

function generateFacts(weapon: WeaponClass, rng: Rng): FactDraw {
  if (weapon === "mine") return mineFacts(rng);
  return aboveFacts(weapon, rng);
}

function mineFacts(rng: Rng): FactDraw {
  const compartment = pick(rng, MINE_COMPARTMENTS);
  let flooding = rng() < CONFIG.damage.mineFloodP;
  const list = rng() < CONFIG.damage.mineListP;
  let settling: Settling = "none";
  if (rng() < CONFIG.damage.mineSettleP) {
    if (compartment === "forepeak" || compartment === "forward-hold") settling = "bow";
    else if (compartment === "engine-room" || compartment === "steering-gear") settling = "stern";
    else settling = rng() < 0.5 ? "bow" : "stern";
  }
  const keelDamage = rng() < (compartment === "midships" ? CONFIG.damage.mineKeelMidP : CONFIG.damage.mineKeelP);
  if (!flooding && !list && settling === "none" && !keelDamage) flooding = true;
  const fire = rng() < CONFIG.damage.mineFireP;
  const smoke = fire && rng() < 0.35;
  return {
    compartment,
    flooding,
    list,
    settling,
    keelDamage,
    fire,
    smoke,
    holeAboveWaterline: false,
    superstructureDamage: false,
    bridgeDamage: false,
    localizedImpact: false,
    heavyBlast: false,
  };
}

function aboveFacts(weapon: "drone" | "missile", rng: Rng): FactDraw {
  const compartment = pick(rng, weapon === "drone" ? DRONE_COMPARTMENTS : MISSILE_COMPARTMENTS);
  const fire = rng() < CONFIG.damage.aboveFireP;
  const smoke = fire ? rng() < 0.85 : rng() < 0.2;
  const flooding = rng() < CONFIG.damage.aboveFloodP;
  const list = flooding && rng() < 0.4;
  const holeAboveWaterline = compartment === "hull-side" || rng() < 0.35;
  const superstructureDamage = compartment === "superstructure" || (compartment === "bridge" && rng() < 0.4);
  const bridgeDamage = compartment === "bridge";
  return {
    compartment,
    flooding,
    list,
    settling: "none",
    keelDamage: false,
    fire,
    smoke,
    holeAboveWaterline,
    superstructureDamage,
    bridgeDamage,
    localizedImpact: weapon === "drone",
    heavyBlast: weapon === "missile",
  };
}

function projectReport(
  weapon: WeaponClass,
  facts: FactDraw,
  stage: "early" | "full",
  rng: Rng,
  compartmentOnly: boolean,
): EvidenceReport {
  if (compartmentOnly && isAftLow(facts.compartment)) {
    return makeCompartmentOnlyReport(facts.compartment, stage, facts.fire ? "fire" : "damaged");
  }
  const keep = (present: boolean): boolean => {
    if (!present) return false;
    if (stage === "full") return true;
    return rng() < CONFIG.damage.earlyKeepP;
  };
  let flooding = keep(facts.flooding);
  let list = keep(facts.list);
  let settling: Settling = keep(facts.settling !== "none") ? facts.settling : "none";
  let keelDamage = keep(facts.keelDamage);
  const fire = keep(facts.fire);
  const smoke = keep(facts.smoke) && (fire || facts.smoke);
  let holeAboveWaterline = keep(facts.holeAboveWaterline);
  let superstructureDamage = keep(facts.superstructureDamage);
  let bridgeDamage = keep(facts.bridgeDamage);
  let localizedImpact = keep(facts.localizedImpact);
  let heavyBlast = keep(facts.heavyBlast);

  if (weapon === "mine") {
    holeAboveWaterline = false;
    superstructureDamage = false;
    bridgeDamage = false;
    localizedImpact = false;
    heavyBlast = false;
    if (!flooding && !list && settling === "none" && !keelDamage) {
      if (facts.flooding) flooding = true;
      else if (facts.list) list = true;
      else if (facts.settling !== "none") settling = facts.settling;
      else if (facts.keelDamage) keelDamage = true;
      else flooding = true;
    }
  }

  const below = flooding || list || settling !== "none" || keelDamage;
  const above =
    holeAboveWaterline || superstructureDamage || bridgeDamage || localizedImpact || heavyBlast || fire || smoke;
  let height: EvidenceReport["heightOfBreach"];
  if (weapon === "mine") height = "below";
  else if (above) height = "above";
  else if (below) height = "below";
  else height = "unknown";

  const droneCue = localizedImpact && !heavyBlast;
  const missileCue = heavyBlast && !localizedImpact;
  let ambiguity: DamageAmbiguity = "none";
  if (height === "unknown") ambiguity = "height";
  else if (height === "above" && !droneCue && !missileCue) ambiguity = "class";

  const report: EvidenceReport = {
    stage,
    heightOfBreach: height,
    ambiguity,
    compartmentOnly: false,
    compartment: facts.compartment,
    flooding,
    list,
    settling,
    keelDamage,
    fire,
    smoke,
    holeAboveWaterline,
    superstructureDamage,
    bridgeDamage,
    localizedImpact,
    heavyBlast,
    text: "",
  };
  report.text = renderDiagnostic(report);
  return report;
}

function renderDiagnostic(report: EvidenceReport): string {
  const lead = report.stage === "early" ? "Initial report, incomplete." : "Follow-up survey.";
  const bits: string[] = [lead];
  if (report.compartment) bits.push(`${compartmentName(report.compartment)} is affected.`);
  if (report.flooding) bits.push(report.heightOfBreach === "above" ? "Flooding is limited." : "The hull is flooding.");
  if (report.list) bits.push("The ship is listing.");
  if (report.settling === "stern") bits.push("The ship is settling by the stern.");
  if (report.settling === "bow") bits.push("The ship is settling by the bow.");
  if (report.keelDamage) bits.push("Possible keel damage, with hogging.");
  if (report.heavyBlast) bits.push("A heavy blast opened the hull side.");
  else if (report.holeAboveWaterline) bits.push("A hole in the hull side above the waterline.");
  if (report.localizedImpact) bits.push("A small localized impact on the upper works.");
  if (report.superstructureDamage) bits.push("The superstructure is damaged.");
  if (report.bridgeDamage) bits.push("The bridge is damaged.");
  if (report.fire) bits.push(report.heightOfBreach === "below" ? "A small fire is also reported." : "Fire is reported.");
  else if (report.heightOfBreach === "below" && report.stage === "full") bits.push("No fire is reported.");
  if (report.smoke) bits.push("Smoke is reported.");
  if (report.heightOfBreach === "below") bits.push("Height of breach: below the waterline.");
  else if (report.heightOfBreach === "above") bits.push("Height of breach: above the waterline.");
  else {
    bits.push(
      "Height of breach unknown. The cable does not establish whether the damage is above or below the waterline, so both a below-waterline hit and an above-waterline hit stay plausible.",
    );
  }
  if (report.stage === "early") bits.push("Some of the damage is not in this cable yet.");
  return bits.join(" ");
}

function compartmentName(compartment: DamageCompartment): string {
  switch (compartment) {
    case "forepeak":
      return "The forepeak";
    case "forward-hold":
      return "A forward cargo tank";
    case "midships":
      return "The midships hull";
    case "engine-room":
      return "The engine room";
    case "steering-gear":
      return "The steering gear";
    case "hull-side":
      return "The hull side";
    case "superstructure":
      return "The superstructure";
    case "bridge":
      return "The bridge";
  }
}

function rollCondition(weapon: WeaponClass, facts: FactDraw, rng: Rng): ShipCondition {
  const weights =
    weapon === "mine"
      ? facts.keelDamage || (facts.flooding && facts.settling !== "none")
        ? CONFIG.damage.mineSevere
        : CONFIG.damage.mineOther
      : isAftLow(facts.compartment) && (facts.fire || facts.flooding)
        ? CONFIG.damage.aboveMachinery
        : CONFIG.damage.aboveOther;
  const roll = rng();
  if (roll < weights.total) return "total_loss";
  if (roll < weights.total + weights.disabled) return "disabled";
  if (roll < weights.total + weights.disabled + weights.tow) return "under_tow";
  return "proceed_slow";
}

function riskFor(facts: FactDraw, condition: ShipCondition): CasualtyRisk {
  if (condition === "total_loss" || facts.keelDamage || (facts.flooding && facts.fire)) return "high";
  if (condition === "proceed_slow" && !facts.fire && !facts.flooding && !facts.heavyBlast) return "low";
  if (condition === "disabled" || facts.fire || facts.flooding || facts.heavyBlast) return "elevated";
  return "low";
}

function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[Math.min(items.length - 1, Math.floor(rng() * items.length))];
}

function clampDay(day: number): number {
  return Math.max(1, Math.min(CONFIG.days + 1, day));
}
