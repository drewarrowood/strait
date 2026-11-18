// All tunable numbers for Strait live in this file.
//
// They are illustrative. They are not a forecast of any real waterway, not a
// measurement of any real navy, and not advice for moving a ship. The point of
// the model is the shape of the problem: overdispersed incidents, slow official
// numbers, fast unreliable claims, and a score that cares about judgment.
//
// Units, unless a field says otherwise:
//   mb     million barrels (a made-up cargo unit; one programme ship = shipMb)
//   mb/d   million barrels per day
//   day    one turn
//
// A "security incident" is something that happens to a merchant ship. The
// player never selects a weapon, a target, or a strike. Escorts and mine
// clearance only change how exposed the next transit is.

import type { Guidance, PublicMessage } from "./types";

export const CONFIG = {
  /** Player turns. The morning after the last day is the close of the books. */
  days: 30,

  /** Illustrative cargo of one tanker in the programme, in million barrels. */
  shipMb: 2,

  /** Escorts available to the cell. Unused ones sit in reserve and cover nobody. */
  escortPool: 6,
  /** How many ships one escort can cover in a day, programme first, then other traffic. */
  shipsPerEscort: 3,
  /** Mine-countermeasures vessels. They sweep a lane; they do not escort. */
  mcmPool: 3,

  /** Hard cap on programme tankers you may call toward the Strait in one day. */
  maxProgrammeShips: 8,

  /** Pipeline nameplate, illustrative mb/d. Not a published operator figure. */
  fujairahCapacityMb: 1.8,
  yanbuCapacityMb: 5,

  /** Oil that wants to leave the producing side each day, before your routing. */
  baseNominationMb: 16,
  nominationShockMb: 0.7,
  /** Once this many ships are waiting, further loadings are shut in instead of joining the queue. */
  anchorageCap: 24,
  /** Political pressure added per ship shut in because the anchorage is full. */
  shutInPressure: 1.6,

  /** System flow (Strait + both bypasses) the illustrative price treats as normal. */
  referenceSystemMb: 18,
  /** Official-release question line. Chosen to sit near a normal sailing plan, not a sure thing. */
  flowQuestionMb: 15,
  /** Gulf + Strait threat-count question line (mine, harassment, security only). */
  incidentQuestionCount: 2,

  /** Ships already waiting when the model starts, before the pre-desk watch. */
  initialBacklog: 4,
  initialPrice: 103,
  initialPressure: 22,

  /**
   * Days simulated before the player sits down, using the baseline plan.
   * Their leftovers are the opening backlog, price, and inbox.
   */
  warmupDays: 3,

  // --- Adversary posture ---------------------------------------------------
  // A hidden index from postureMin to postureMax. It drifts, mean-reverts,
  // and sometimes jumps. The player never sees it until the debrief.
  // Escorts barely move it. They change exposure, not the other side's intent.
  postureMean: 0.4,
  postureInitSpread: 0.08,
  postureMeanRevert: 0.16,
  postureShock: 0.07,
  spikeUpP: 0.05,
  spikeUp: 0.2,
  spikeDownP: 0.04,
  spikeDown: 0.16,
  /** Subtracted times the fraction of the escort pool that is actually at sea. Kept small on purpose. */
  postureDeter: 0.025,
  postureMin: 0.06,
  postureMax: 0.92,

  // --- Mines ---------------------------------------------------------------
  // Density is a hidden hazard per transit, not a count of weapons.
  // Each sweeper removes a fraction per day. Hazard also decays on its own
  // and is replenished while posture is elevated. Clearing a lane takes days.
  mineInit: { strait: 0.05, oman: 0.018, bab: 0.04 },
  mineInitJitter: 0.35,
  mineLayBase: 0.02,
  mineLayExcite: 0.35,
  mineNaturalDecay: 0.06,
  /** Fraction of density removed by one MCM vessel in one day. Two vessels stack. */
  mcmClearFraction: 0.22,
  mineCap: 0.9,
  /** Multiplies density inside the convoy's exposure. Larger convoys are slightly more exposed and much fewer in number. */
  mineSizeIntercept: 0.65,
  mineSizeSlope: 0.055,
  mineDamageP: 0.42,
  /** Chance the rest of the convoy abandons the transit after a mine contact. This is the clustering cost of a big convoy. */
  mineAbortP: 0.6,
  /** Chance of crew casualties given a damaging mine contact. */
  mineCasP: 0.2,

  // --- Incidents against merchant ships ------------------------------------
  // Probabilities below are rates inside an exponential: p = 1 - exp(-rate).
  // Escorts multiply the rate. They do not "shoot back" in this model.
  secBase: 0.06,
  secDamageP: 0.62,
  secCasP: 0.32,
  escortSecMult: 0.38,
  harBase: 0.18,
  harDamageP: 0.07,
  harCasP: 0.04,
  escortHarMult: 0.34,
  gnssBase: 0.14,
  /** Congestion is an own-goal of bunching ships, not an attack. */
  congBaseSmall: 0.01,
  congBaseLarge: 0.055,
  congLargeMinShips: 8,
  clusterMinSize: 8,
  clusterP: 0.34,
  clusterExtraMean: 1.1,
  clusterExtraK: 1.1,
  extraCasualtyMean: 0.4,
  extraCasualtyK: 1.2,
  maxCasualtiesPerIncident: 3,
  missingGivenCasualtyP: 0.28,

  /** Per-day chance the anchorage itself is disturbed. Waiting stays much safer than transiting. */
  anchorDaily: 0.012,
  anchorDamageP: 0.12,

  /** Zone multipliers on security and harassment rates. */
  zoneRate: { strait: 1, oman: 0.72, bab: 1.12, gulf: 0.35, yanbu: 0.2 },

  // --- Self-excitation -----------------------------------------------------
  // A bad day raises the next days' rates, then the effect fades.
  // Together with the negative-binomial traffic counts, this is the
  // overdispersion: quiet weeks, then a cluster, with no new "cause" the
  // player is allowed to see.
  exciteWeight: 0.42,
  exciteDecay: 0.7,
  excitePerEvent: 1,
  exciteCap: 5,

  // --- Other traffic -------------------------------------------------------
  /** Mean ships in the Strait that you do not schedule. Negative-binomial, then capped. */
  backgroundMean: 2.15,
  /** Dispersion k. Lower is burstier. Variance = mean + mean^2/k. */
  backgroundK: 0.9,
  /** Hard cap so a single overdispersed draw cannot invent a fantasy day of traffic. */
  backgroundCap: 6,
  backgroundFactor: { sail: 1, caution: 0.68, defer: 0.36 } as Record<Guidance, number>,
  /** Loadings and bunkers off Fujairah that are not your pipeline cargo. */
  omanBackgroundMean: 0.7,
  omanBackgroundK: 1.1,
  omanBackgroundCap: 3,

  /** Share of unescorted programme ships that sail anyway under "caution". Under "defer", none do. Under "sail", all do. */
  cautionUnescortedObey: 0.5,

  // --- Pipelines and Suez --------------------------------------------------
  pipelineHazard: 0.055,
  /** Throughput left during an outage, as a fraction of nameplate. */
  outageUptime: 0.34,
  /** Days the restriction lasts, including the day it starts. */
  outageDays: 3,
  /** Northbound Yanbu cargo can wait on the Suez queue. No Bab transit, no attack. */
  suezDelayP: 0.08,
  suezSlipFraction: 0.45,

  // --- Price and political pressure ---------------------------------------
  // The price index starts near 100. It is not a dollar price.
  // It mean-reverts toward a target set by the flow gap, the public line,
  // and harm. Harm is noisy so the index cannot be inverted into a body count.
  priceBase: 100,
  priceAdapt: 0.32,
  priceGap: 0.028,
  pricePerDamage: 0.018,
  pricePerCasualty: 0.03,
  priceFloor: 55,
  priceCeil: 220,
  messagePrice: {
    reassure: -0.018,
    factual: 0,
    warn: 0.012,
    silent: 0.004,
  } as Record<PublicMessage, number>,

  pressureDecay: 0.965,
  /** Backlog above this many ships starts to add pressure. */
  backlogFree: 6,
  pressurePerBacklogShip: 0.45,
  pressurePerCasualty: 5.5,
  pressurePerDamage: 0.7,
  pressurePerPricePoint: 0.08,
  /** Added when the public line was "reassure" on a day crews were hurt or ships were damaged. */
  reassureWhiplash: 6,
  /** Added when a warning has been running for this many quiet days. */
  wolfDays: 6,
  wolfPenalty: 1.4,

  // --- Official releases ---------------------------------------------------
  /** Mornings on which the joint flow figure and incident bulletin are filed. */
  releaseMornings: [8, 15, 22, 29],
  /** Standard deviation of the printed flow figure, mb/d. */
  releaseNoiseMb: 0.42,
  /** The bulletin omits incidents from the last day of the window (still in processing). */
  bulletinLagDays: 1,

  // --- Reports -------------------------------------------------------------
  // Probabilities that an event becomes a particular kind of claim.
  // Latency is at least one day: the player reads them the next morning.
  reports: {
    minLatency: 1,
    lateLatency: 4,
    ukmtoP: { mine: 0.9, security: 0.88, harassment: 0.84, gnss: 0.72, congestion: 0.18, pipeline: 0.25 },
    ukmtoLateP: 0.18,
    ukmtoMislocP: 0.15,
    liaisonProgrammeP: 0.96,
    liaisonBackgroundP: 0.62,
    stateP: 0.66,
    stateInflateP: 0.62,
    stateInflateExtra: 3,
    stateMislocP: 0.28,
    /** Chance a day grows an extra state-media claim with no event behind it. */
    stateFabricateP: 0.17,
    pressDupP: 0.46,
    /** Chance of a wire story that prints a multi-day sum as if it were fresh. */
    pressRunningP: 0.4,
    anonP: 0.32,
    anonFabricateP: 0.07,
    /** Chance a real confirmable event is included in the weekly bulletin. */
    jmicIncludeP: 0.94,
  },

  // --- Questions -----------------------------------------------------------
  // One question on each of these mornings. Flow questions resolve when the
  // release prints. The others are sealed until the debrief.
  questions: [
    { day: 4, kind: "incidents" as const, window: [4, 10] as [number, number] },
    { day: 7, kind: "flow" as const, releaseMorning: 8 },
    { day: 9, kind: "claim" as const },
    { day: 11, kind: "incidents" as const, window: [11, 17] as [number, number] },
    { day: 14, kind: "flow" as const, releaseMorning: 15 },
    { day: 16, kind: "claim" as const },
    { day: 18, kind: "incidents" as const, window: [18, 24] as [number, number] },
    { day: 21, kind: "flow" as const, releaseMorning: 22 },
    { day: 24, kind: "incidents" as const, window: [24, 30] as [number, number] },
    { day: 28, kind: "flow" as const, releaseMorning: 29 },
  ],

  // --- Projection bands ----------------------------------------------------
  projectionSamples: 60,
  projectionHorizonDays: 7,

  // --- Debrief replay ------------------------------------------------------
  /** How many fresh seeds the same decisions are replayed on. */
  replaySamples: 80,

  // --- Judgment score ------------------------------------------------------
  // Weights sum to 1. The operational part uses mean utility across replays,
  // so a fat tail of casualties counts even when the median looks acceptable.
  scoreWeights: { forecast: 0.4, ledger: 0.3, operational: 0.3 },
  /** Brier score of a forecaster who always says 50%. Skill is measured against this. */
  brierReference: 0.25,
  /** Log score clamps probabilities into this open interval so a 0 or 1 cannot explode. */
  logClamp: 0.02,
  /**
   * Utility of a finished campaign. Mean daily system flow is the mission.
   * Casualties dominate damage; a quiet backlog still has a cost.
   * Tuned so a steady baseline beats both "sail everything unescorted"
   * and "hold almost everything".
   */
  utility: {
    perMeanSystemMb: 3,
    perCasualty: 9,
    perMissing: 3,
    perDamage: 1.6,
    perEndBacklogShip: 0.22,
    perPressurePoint: 0.08,
    perPricePointOverBase: 0.04,
  },
  /** How many utility points above the baseline count as a full operational mark. */
  utilityScale: 8,

  /** Probability at or below this, after a zero bulletin, can be "shelving". */
  shelveProbability: 0.1,
  /** How far back a zero joint bulletin still counts as the "one low reading". */
  shelveLookbackDays: 10,
};
