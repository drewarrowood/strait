import { CONFIG } from "./config";
import {
  assessHit,
  damageDispatch,
  damageRestatement,
  damagingKind,
  playerCable,
  recoveryFor,
  stageFor,
} from "./damage";
import { BASELINE, guidanceLabel, messageLabel, sanitizeDecision } from "./decide";
import { oneDecimal } from "./format";
import { zoneName } from "./labels";
import { clamp, rngFor, sampleNegBin, sampleNormal, type Rng } from "./rng";
import type {
  DayRecord,
  Decisions,
  IncidentKind,
  Opening,
  Report,
  TrueEvent,
  World,
  Zone,
} from "./types";
import { reportText } from "./wording";

export interface SimOptions {
  /** Contested reports and official releases. Off for replays and projection bands. */
  reports?: boolean;
  /** Pre-desk watch that builds the opening inbox. Off for projection bands. */
  warmup?: boolean;
  initialBacklog?: number;
  initialPrice?: number;
  initialPressure?: number;
}

export interface CampaignTotals {
  days: number;
  meanStraitMb: number;
  meanSystemMb: number;
  totalStraitMb: number;
  totalSystemMb: number;
  totalBypassMb: number;
  totalDamage: number;
  totalCasualties: number;
  totalMissing: number;
  endBacklog: number;
  endPrice: number;
  endPressure: number;
  meanBacklog: number;
  programmeDamage: number;
  backgroundDamage: number;
}

const THREAT: ReadonlySet<IncidentKind> = new Set(["mine", "harassment", "security"]);
const NEIGHBOR: Record<Zone, Zone[]> = {
  strait: ["gulf", "oman"],
  gulf: ["strait"],
  oman: ["strait"],
  bab: ["yanbu"],
  yanbu: ["bab"],
};

interface Internal {
  posture: number;
  mine: Record<"strait" | "oman" | "bab", number>;
  excitation: number;
  backlog: number;
  shipFraction: number;
  price: number;
  pressure: number;
  quietWarnDays: number;
  fujRepair: number;
  yanbuRepair: number;
  fujUptime: number;
  yanbuUptime: number;
  suezQueue: number;
  seqE: number;
  seqR: number;
}

interface LaneResult {
  arrived: number;
  returned: number;
  damaged: number;
  casualties: number;
  missing: number;
  events: TrueEvent[];
}

/**
 * Run a campaign. `decisions[0]` is day 1.
 * Streams are named by day and purpose, so the same seed and the same
 * decisions always rebuild the same hidden log.
 */
export function simulate(seed: string, decisions: readonly Decisions[], options: SimOptions = {}): World {
  const reportsOn = options.reports !== false;
  const warmupOn = options.warmup !== false;
  const world: World = {
    seed,
    events: [],
    reports: [],
    releases: [],
    days: [],
    opening: { backlogShips: 0, priceIndex: 0, pressure: 0 },
  };
  const state = initialState(seed, options);
  if (warmupOn) {
    for (let i = 0; i < CONFIG.warmupDays; i++) {
      runDay(seed, state, world, i - CONFIG.warmupDays, BASELINE, reportsOn);
    }
  }
  world.opening = snapshotOpening(state);
  for (let i = 0; i < decisions.length; i++) {
    runDay(seed, state, world, i + 1, sanitizeDecision(decisions[i]), reportsOn);
  }
  return world;
}

export function summarize(world: World): CampaignTotals {
  const days = world.days;
  const n = Math.max(1, days.length);
  let strait = 0;
  let system = 0;
  let bypass = 0;
  let damage = 0;
  let cas = 0;
  let missing = 0;
  let backlog = 0;
  let programmeDamage = 0;
  let backgroundDamage = 0;
  for (const day of days) {
    strait += day.straitFlowMb;
    system += day.systemFlowMb;
    bypass += day.fujFlowMb + day.yanbuFlowMb;
    damage += day.damageToday;
    cas += day.casualtiesToday;
    missing += day.missingToday;
    backlog += day.backlogShips;
    programmeDamage += day.programmeDamaged;
    backgroundDamage += day.backgroundDamaged;
  }
  const last = days[days.length - 1];
  return {
    days: days.length,
    meanStraitMb: strait / n,
    meanSystemMb: system / n,
    totalStraitMb: strait,
    totalSystemMb: system,
    totalBypassMb: bypass,
    totalDamage: damage,
    totalCasualties: cas,
    totalMissing: missing,
    endBacklog: last ? last.backlogShips : world.opening.backlogShips,
    endPrice: last ? last.priceIndex : world.opening.priceIndex,
    endPressure: last ? last.pressure : world.opening.pressure,
    meanBacklog: backlog / n,
    programmeDamage,
    backgroundDamage,
  };
}

export function utilityOf(totals: CampaignTotals): number {
  const u = CONFIG.utility;
  return (
    u.perMeanSystemMb * totals.meanSystemMb -
    u.perCasualty * totals.totalCasualties -
    u.perMissing * totals.totalMissing -
    u.perDamage * totals.totalDamage -
    u.perEndBacklogShip * totals.endBacklog -
    u.perPressurePoint * totals.endPressure -
    u.perPricePointOverBase * Math.max(0, totals.endPrice - CONFIG.priceBase)
  );
}

function initialState(seed: string, options: SimOptions): Internal {
  const rng = rngFor(seed, "init");
  const jitter = (base: number) => base * (1 - CONFIG.mineInitJitter / 2 + CONFIG.mineInitJitter * rng());
  return {
    posture: clamp(
      CONFIG.postureMean + CONFIG.postureInitSpread * sampleNormal(rng),
      CONFIG.postureMin,
      CONFIG.postureMax,
    ),
    mine: {
      strait: jitter(CONFIG.mineInit.strait),
      oman: jitter(CONFIG.mineInit.oman),
      bab: jitter(CONFIG.mineInit.bab),
    },
    excitation: 0.25,
    backlog: options.initialBacklog ?? CONFIG.initialBacklog,
    shipFraction: 0,
    price: options.initialPrice ?? CONFIG.initialPrice,
    pressure: options.initialPressure ?? CONFIG.initialPressure,
    quietWarnDays: 0,
    fujRepair: 0,
    yanbuRepair: 0,
    fujUptime: 1,
    yanbuUptime: 1,
    suezQueue: 0,
    seqE: 1,
    seqR: 1,
  };
}

function snapshotOpening(state: Internal): Opening {
  return {
    backlogShips: state.backlog,
    priceIndex: round1(state.price),
    pressure: round1(state.pressure),
  };
}

function runDay(
  seed: string,
  state: Internal,
  world: World,
  day: number,
  decision: Decisions,
  reportsOn: boolean,
): void {
  const postureRng = rngFor(seed, `posture|${day}`);
  const escortFrac =
    (decision.escortStrait + decision.escortOman + decision.escortBab) / CONFIG.escortPool;
  let posture = state.posture + CONFIG.postureMeanRevert * (CONFIG.postureMean - state.posture);
  posture += CONFIG.postureShock * sampleNormal(postureRng);
  if (postureRng() < CONFIG.spikeUpP) posture += CONFIG.spikeUp;
  if (postureRng() < CONFIG.spikeDownP) posture -= CONFIG.spikeDown;
  posture -= CONFIG.postureDeter * escortFrac;
  state.posture = clamp(posture, CONFIG.postureMin, CONFIG.postureMax);

  state.excitation = Math.min(CONFIG.exciteCap, state.excitation * CONFIG.exciteDecay);
  const exciteMult = 1 + CONFIG.exciteWeight * state.excitation;

  const mineRng = rngFor(seed, `mine|${day}`);
  state.mine.strait = evolveMine(state.mine.strait, decision.mcmStrait, state.posture, exciteMult, mineRng);
  state.mine.oman = evolveMine(state.mine.oman, decision.mcmOman, state.posture, exciteMult, mineRng);
  state.mine.bab = evolveMine(state.mine.bab, decision.mcmBab, state.posture, exciteMult, mineRng);

  const pipeRng = rngFor(seed, `pipe|${day}`);
  const fujStarted = stepOutage(
    state,
    "fuj",
    decision.fujairahMb,
    CONFIG.fujairahCapacityMb,
    state.posture,
    exciteMult,
    pipeRng,
  );
  const yanbuStarted = stepOutage(
    state,
    "yanbu",
    decision.yanbuMb,
    CONFIG.yanbuCapacityMb,
    state.posture,
    exciteMult,
    pipeRng,
  );
  const fujAvail = CONFIG.fujairahCapacityMb * state.fujUptime;
  const yanbuAvail = CONFIG.yanbuCapacityMb * state.yanbuUptime;

  const nomRng = rngFor(seed, `nomination|${day}`);
  const nomination = clamp(
    CONFIG.baseNominationMb + CONFIG.nominationShockMb * sampleNormal(nomRng),
    13,
    21,
  );
  let fuj = clamp(decision.fujairahMb, 0, fujAvail);
  let yanbu = clamp(decision.yanbuMb, 0, yanbuAvail);
  if (fuj + yanbu > nomination) {
    const scale = nomination / (fuj + yanbu);
    fuj *= scale;
    yanbu *= scale;
  }
  const fujRestricted = state.fujUptime < 1;
  const yanbuRestricted = state.yanbuUptime < 1;

  state.shipFraction += (nomination - fuj - yanbu) / CONFIG.shipMb;
  const newShips = Math.max(0, Math.floor(state.shipFraction + 1e-9));
  state.shipFraction -= newShips;
  const room = Math.max(0, CONFIG.anchorageCap - state.backlog);
  const queued = Math.min(newShips, room);
  const shutInShips = newShips - queued;
  state.backlog += queued;

  const slots = decision.escortStrait * CONFIG.shipsPerEscort;
  const requested = Math.min(state.backlog, decision.straitAttemptShips);
  const escortedWant = Math.min(requested, slots);
  const unescortedWant = requested - escortedWant;
  const unescortedGo =
    decision.guidance === "defer"
      ? 0
      : decision.guidance === "caution"
        ? Math.round(unescortedWant * CONFIG.cautionUnescortedObey)
        : unescortedWant;
  const programmeShips = escortedWant + unescortedGo;
  state.backlog -= programmeShips;

  const dayEvents: TrueEvent[] = [];
  let straitSlowMb = 0;
  let straitAnchorReturns = 0;
  const programmeLane = runLane({
    seed,
    state,
    day,
    zone: "strait",
    programme: true,
    shipsEscorted: escortedWant,
    shipsUnescorted: unescortedGo,
    convoySize: decision.convoySize,
    mine: state.mine.strait,
    key: `p-strait|${day}`,
    posture: state.posture,
    exciteMult,
  });
  dayEvents.push(...programmeLane.events);
  const programmeRecovery = recoveryFor(programmeLane.events);
  state.backlog += programmeLane.returned + programmeRecovery.anchorReturns;
  straitSlowMb = programmeRecovery.flowBackMb;
  straitAnchorReturns = programmeRecovery.anchorReturns;

  const bgRng = rngFor(seed, `background|${day}`);
  const bgMean = CONFIG.backgroundMean * CONFIG.backgroundFactor[decision.guidance];
  const backgroundShips = Math.min(CONFIG.backgroundCap, sampleNegBin(bgRng, bgMean, CONFIG.backgroundK));
  const spare = Math.max(0, slots - escortedWant);
  const bgEscorted = Math.min(backgroundShips, spare);
  const backgroundLane = runLane({
    seed,
    state,
    day,
    zone: "strait",
    programme: false,
    shipsEscorted: bgEscorted,
    shipsUnescorted: backgroundShips - bgEscorted,
    convoySize: decision.convoySize,
    mine: state.mine.strait,
    key: `b-strait|${day}`,
    posture: state.posture,
    exciteMult,
  });
  dayEvents.push(...backgroundLane.events);

  const omanRng = rngFor(seed, `oman-ships|${day}`);
  const fujShips = fractionalShips(omanRng, fuj / CONFIG.shipMb);
  const omanBg = Math.min(
    CONFIG.omanBackgroundCap,
    sampleNegBin(omanRng, CONFIG.omanBackgroundMean * CONFIG.backgroundFactor[decision.guidance], CONFIG.omanBackgroundK),
  );
  const omanSlots = decision.escortOman * CONFIG.shipsPerEscort;
  const fujEscorted = Math.min(fujShips, omanSlots);
  const fujLane = runLane({
    seed,
    state,
    day,
    zone: "oman",
    programme: true,
    shipsEscorted: fujEscorted,
    shipsUnescorted: fujShips - fujEscorted,
    convoySize: Math.min(decision.convoySize, 4) as Decisions["convoySize"],
    mine: state.mine.oman,
    key: `fuj|${day}`,
    posture: state.posture,
    exciteMult,
  });
  const omanSpare = Math.max(0, omanSlots - fujEscorted);
  const omanBgLane = runLane({
    seed,
    state,
    day,
    zone: "oman",
    programme: false,
    shipsEscorted: Math.min(omanBg, omanSpare),
    shipsUnescorted: Math.max(0, omanBg - omanSpare),
    convoySize: 2,
    mine: state.mine.oman,
    key: `oman-bg|${day}`,
    posture: state.posture,
    exciteMult,
  });
  dayEvents.push(...fujLane.events, ...omanBgLane.events);
  const fujRecovery = recoveryFor(fujLane.events);
  const fujLost = (fujLane.damaged + fujLane.returned) * CONFIG.shipMb;
  const fujFlow = Math.max(0, fuj - fujLost + Math.min(fujRecovery.flowBackMb, fujLost));

  const babRng = rngFor(seed, `bab-ships|${day}`);
  const southShips = fractionalShips(babRng, (yanbu * decision.yanbuSouthShare) / CONFIG.shipMb);
  const babSlots = decision.escortBab * CONFIG.shipsPerEscort;
  const babEscorted = Math.min(southShips, babSlots);
  const babLane = runLane({
    seed,
    state,
    day,
    zone: "bab",
    programme: true,
    shipsEscorted: babEscorted,
    shipsUnescorted: southShips - babEscorted,
    convoySize: decision.convoySize,
    mine: state.mine.bab,
    key: `bab|${day}`,
    posture: state.posture,
    exciteMult,
  });
  dayEvents.push(...babLane.events);
  const babRecovery = recoveryFor(babLane.events);
  const babLost = (babLane.damaged + babLane.returned) * CONFIG.shipMb;

  const suezRng = rngFor(seed, `suez|${day}`);
  const releasedQueue = state.suezQueue;
  state.suezQueue = 0;
  const northMb = Math.max(0, yanbu - southShips * CONFIG.shipMb);
  let suezSlip = 0;
  if (suezRng() < CONFIG.suezDelayP && northMb > 0.2) {
    suezSlip = northMb * CONFIG.suezSlipFraction;
    state.suezQueue = suezSlip;
  }
  const yanbuFlow = Math.max(
    0,
    yanbu - babLost - suezSlip + releasedQueue + Math.min(babRecovery.flowBackMb, babLost),
  );

  if (fujStarted) {
    dayEvents.push(outageEvent(state, day, "oman", Math.max(0, decision.fujairahMb - fujFlow), "Fujairah"));
  }
  if (yanbuStarted) {
    dayEvents.push(outageEvent(state, day, "yanbu", Math.max(0, decision.yanbuMb - yanbu), "Yanbu"));
  }

  const anchorRng = rngFor(seed, `anchor|${day}`);
  const anchorP = clamp(CONFIG.anchorDaily * (state.posture / CONFIG.postureMean) * exciteMult, 0, 0.5);
  if (state.backlog >= 1 && anchorRng() < anchorP) {
    const damaged = anchorRng() < CONFIG.anchorDamageP ? 1 : 0;
    if (damaged) state.backlog -= 1;
    const harm = casualtyDraw(anchorRng, damaged, CONFIG.harCasP);
    dayEvents.push(
      makeEvent(state, {
        day,
        zone: "gulf",
        kind: "harassment",
        programme: true,
        shipsAffected: 1,
        shipsDamaged: damaged,
        casualties: harm.casualties,
        missing: harm.missing,
        flowLostMb: damaged ? CONFIG.shipMb : 0,
        escorted: false,
        convoySize: 1,
        summary:
          damaged === 1
            ? "A ship at anchor in the Arabian Gulf reported harassment and hull damage."
            : "A ship at anchor in the Arabian Gulf reported harassment and stayed at anchor.",
      }),
    );
  }

  const threatEvents = dayEvents.filter((event) => THREAT.has(event.kind));
  state.excitation = Math.min(
    CONFIG.exciteCap,
    state.excitation + threatEvents.length * CONFIG.excitePerEvent,
  );

  const backgroundRecovery = recoveryFor(backgroundLane.events);
  const programmeFlow = programmeLane.arrived * CONFIG.shipMb + straitSlowMb;
  const backgroundFlow = backgroundLane.arrived * CONFIG.shipMb + backgroundRecovery.flowBackMb;
  const straitFlow = programmeFlow + backgroundFlow;
  const systemFlow = straitFlow + fujFlow + yanbuFlow;

  const damageToday = dayEvents.reduce((sum, event) => sum + event.shipsDamaged, 0);
  const casualtiesToday = dayEvents.reduce((sum, event) => sum + event.casualties, 0);
  const missingToday = dayEvents.reduce((sum, event) => sum + event.missing, 0);
  const programmeDamage = programmeLane.damaged + fujLane.damaged + babLane.damaged + dayEvents
    .filter((event) => event.zone === "gulf" && event.programme)
    .reduce((sum, event) => sum + event.shipsDamaged, 0);
  const programmeCas =
    programmeLane.casualties +
    fujLane.casualties +
    babLane.casualties +
    dayEvents.filter((event) => event.zone === "gulf" && event.programme).reduce((sum, event) => sum + event.casualties, 0);
  const programmeMissing =
    programmeLane.missing +
    fujLane.missing +
    babLane.missing +
    dayEvents.filter((event) => event.zone === "gulf" && event.programme).reduce((sum, event) => sum + event.missing, 0);

  const priceRng = rngFor(seed, `price|${day}`);
  const gap = CONFIG.referenceSystemMb - systemFlow;
  const target =
    CONFIG.priceBase *
    Math.exp(
      CONFIG.priceGap * gap +
        CONFIG.messagePrice[decision.message] +
        damageToday * CONFIG.pricePerDamage * (0.65 + 0.7 * priceRng()) +
        casualtiesToday * CONFIG.pricePerCasualty * (0.5 + priceRng()),
    );
  state.price = clamp(
    state.price + CONFIG.priceAdapt * (target - state.price),
    CONFIG.priceFloor,
    CONFIG.priceCeil,
  );

  const pressureRng = rngFor(seed, `pressure|${day}`);
  if (damageToday === 0 && casualtiesToday === 0 && decision.message === "warn") state.quietWarnDays += 1;
  else if (damageToday > 0 || casualtiesToday > 0) state.quietWarnDays = 0;
  else state.quietWarnDays = Math.max(0, state.quietWarnDays - 1);

  let pressure = state.pressure * CONFIG.pressureDecay;
  pressure += CONFIG.pressurePerBacklogShip * Math.max(0, state.backlog - CONFIG.backlogFree);
  pressure += casualtiesToday * CONFIG.pressurePerCasualty * (0.7 + 0.6 * pressureRng());
  pressure += damageToday * CONFIG.pressurePerDamage;
  pressure += Math.max(0, state.price - CONFIG.priceBase) * CONFIG.pressurePerPricePoint;
  pressure += shutInShips * CONFIG.shutInPressure;
  if (decision.message === "reassure" && (damageToday > 0 || casualtiesToday > 0)) {
    pressure += CONFIG.reassureWhiplash;
  }
  if (decision.message === "warn" && state.quietWarnDays >= CONFIG.wolfDays) pressure += CONFIG.wolfPenalty;
  state.pressure = clamp(pressure, 0, 100);

  const gulfStraitThreats = dayEvents.filter(
    (event) => (event.zone === "gulf" || event.zone === "strait") && THREAT.has(event.kind),
  ).length;

  const notes = operatorNotes({
    decision,
    programmeShips,
    escortedWant,
    unescortedGo,
    arrived: programmeLane.arrived,
    returned: programmeLane.returned,
    damaged: programmeLane.damaged + fujLane.damaged + babLane.damaged,
    casualties: programmeCas,
    missing: programmeMissing,
    programmeFlow,
    fujAsked: decision.fujairahMb,
    fujFlow,
    fujOutage: fujRestricted,
    yanbuAsked: decision.yanbuMb,
    yanbuFlow,
    yanbuOutage: yanbuRestricted,
    southShips,
    babDamaged: babLane.damaged,
    babReturned: babLane.returned,
    suezSlip,
    backlog: state.backlog,
    shutInShips,
    straitSlowMb,
    straitAnchorReturns,
    fujSlowMb: Math.min(fujRecovery.flowBackMb, fujLost),
    babSlowMb: Math.min(babRecovery.flowBackMb, babLost),
    damageCables: dayEvents.some((event) => event.programme && event.damage != null),
  });

  if (day >= 1) {
    const record: DayRecord = {
      day,
      posture: round3(state.posture),
      mineStrait: round3(state.mine.strait),
      mineOman: round3(state.mine.oman),
      mineBab: round3(state.mine.bab),
      excitation: round3(state.excitation),
      nominationMb: round1(nomination),
      straitFlowMb: round1(straitFlow),
      programmeStraitFlowMb: round1(programmeFlow),
      backgroundStraitFlowMb: round1(backgroundFlow),
      fujFlowMb: round1(fujFlow),
      yanbuFlowMb: round1(yanbuFlow),
      systemFlowMb: round1(systemFlow),
      backlogShips: state.backlog,
      priceIndex: round1(state.price),
      pressure: round1(state.pressure),
      programmeAttempted: programmeShips,
      programmeEscorted: escortedWant,
      programmeArrived: programmeLane.arrived,
      programmeReturned: programmeLane.returned,
      programmeDamaged: programmeDamage,
      programmeCasualties: programmeCas,
      programmeMissing: programmeMissing,
      backgroundShips,
      backgroundDamaged: backgroundLane.damaged + omanBgLane.damaged,
      backgroundCasualties: backgroundLane.casualties + omanBgLane.casualties,
      fujNominatedMb: round1(decision.fujairahMb),
      yanbuNominatedMb: round1(decision.yanbuMb),
      yanbuSouthShips: southShips,
      operatorNotes: notes,
      damageToday,
      casualtiesToday,
      missingToday,
      gulfStraitThreats,
    };
    world.days.push(record);
  }

  world.events.push(...dayEvents);
  if (reportsOn) {
    fileReports(seed, state, world, day, dayEvents);
    const releaseMorning = day + 1;
    if (CONFIG.releaseMornings.includes(releaseMorning) && day >= 1) {
      fileRelease(seed, state, world, day, releaseMorning);
    }
  }
}

function evolveMine(density: number, mcm: number, posture: number, exciteMult: number, rng: Rng): number {
  const clear = 1 - Math.pow(1 - CONFIG.mcmClearFraction, mcm);
  const lay = CONFIG.mineLayBase * posture * exciteMult * (0.75 + 0.5 * rng());
  const next = density * (1 - CONFIG.mineNaturalDecay) * (1 - clear) + lay;
  return clamp(next, 0, CONFIG.mineCap);
}

function stepOutage(
  state: Internal,
  which: "fuj" | "yanbu",
  asked: number,
  nameplate: number,
  posture: number,
  exciteMult: number,
  rng: Rng,
): boolean {
  const repairKey = which === "fuj" ? "fujRepair" : "yanbuRepair";
  const upKey = which === "fuj" ? "fujUptime" : "yanbuUptime";
  if (state[repairKey] > 0) {
    state[upKey] = CONFIG.outageUptime;
    state[repairKey] -= 1;
    return false;
  }
  const util = clamp(asked / nameplate, 0, 1);
  const hazard = CONFIG.pipelineHazard * posture * exciteMult * (0.35 + 0.65 * util);
  if (rng() < hazard) {
    state[upKey] = CONFIG.outageUptime;
    state[repairKey] = Math.max(0, CONFIG.outageDays - 1);
    return true;
  }
  state[upKey] = 1;
  return false;
}

function outageEvent(state: Internal, day: number, zone: Zone, lost: number, name: string): TrueEvent {
  return makeEvent(state, {
    day,
    zone,
    kind: "pipeline",
    programme: true,
    shipsAffected: 0,
    shipsDamaged: 0,
    casualties: 0,
    missing: 0,
    flowLostMb: round1(Math.max(0, lost)),
    escorted: false,
    convoySize: 0,
    summary: `${name} pipeline throughput fell after a station outage. The open record does not establish a cause. This model attaches no crew casualty to a pipeline outage.`,
  });
}

interface LaneOpts {
  seed: string;
  state: Internal;
  day: number;
  zone: Zone;
  programme: boolean;
  shipsEscorted: number;
  shipsUnescorted: number;
  convoySize: number;
  mine: number;
  key: string;
  posture: number;
  exciteMult: number;
}

function runLane(opts: LaneOpts): LaneResult {
  const result: LaneResult = { arrived: 0, returned: 0, damaged: 0, casualties: 0, missing: 0, events: [] };
  const groups: Array<{ size: number; escorted: boolean }> = [
    ...chunk(opts.shipsEscorted, opts.convoySize).map((size) => ({ size, escorted: true })),
    ...chunk(opts.shipsUnescorted, opts.convoySize).map((size) => ({ size, escorted: false })),
  ];
  groups.forEach((group, index) => {
    const rng = rngFor(opts.seed, `${opts.key}|c${index}|${group.escorted ? "e" : "u"}`);
    const outcome = resolveConvoy(opts, group.size, group.escorted, rng);
    result.arrived += outcome.arrived;
    result.returned += outcome.returned;
    result.damaged += outcome.damaged;
    result.casualties += outcome.casualties;
    result.missing += outcome.missing;
    result.events.push(...outcome.events);
  });
  return result;
}

function resolveConvoy(opts: LaneOpts, size: number, escorted: boolean, rng: Rng): LaneResult {
  const empty: LaneResult = { arrived: size, returned: 0, damaged: 0, casualties: 0, missing: 0, events: [] };
  if (size <= 0) return { ...empty, arrived: 0 };
  const sizeFactor = CONFIG.mineSizeIntercept + CONFIG.mineSizeSlope * size;
  const escortSec = escorted ? CONFIG.escortSecMult : 1;
  const escortHar = escorted ? CONFIG.escortHarMult : 1;
  const zoneRate = CONFIG.zoneRate[opts.zone];
  const mineP = 1 - Math.exp(-opts.mine * sizeFactor);
  const secP = 1 - Math.exp(-CONFIG.secBase * opts.posture * opts.exciteMult * escortSec * sizeFactor * zoneRate);
  const harP = 1 - Math.exp(-CONFIG.harBase * opts.posture * opts.exciteMult * escortHar * zoneRate);
  const gnssP = 1 - Math.exp(-CONFIG.gnssBase * opts.posture * (opts.zone === "strait" || opts.zone === "oman" ? 1 : 0.4));
  const congP =
    size >= CONFIG.congLargeMinShips
      ? CONFIG.congBaseLarge * (size / CONFIG.congLargeMinShips)
      : CONFIG.congBaseSmall * (size / 4);

  let left = size;
  const events: TrueEvent[] = [];
  let damaged = 0;
  let returned = 0;
  let casualties = 0;
  let missing = 0;

  const take = (kind: "damage" | "return", n: number): number => {
    const k = Math.max(0, Math.min(left, n));
    left -= k;
    if (kind === "damage") damaged += k;
    else returned += k;
    return k;
  };

  if (rng() < secP && left > 0) {
    let affected = 1;
    if (size >= CONFIG.clusterMinSize && rng() < CONFIG.clusterP) {
      affected = Math.min(size, 1 + sampleNegBin(rng, CONFIG.clusterExtraMean, CONFIG.clusterExtraK));
    }
    affected = Math.min(affected, left);
    let dmg = 0;
    for (let i = 0; i < affected; i++) if (rng() < CONFIG.secDamageP) dmg += 1;
    const d = take("damage", dmg);
    take("return", affected - dmg);
    const harm = casualtyDraw(rng, d, CONFIG.secCasP);
    casualties += harm.casualties;
    missing += harm.missing;
    events.push(transitEvent(opts, size, escorted, "security", affected, d, harm, rng));
  }

  if (rng() < mineP && left > 0) {
    const d = rng() < CONFIG.mineDamageP ? take("damage", 1) : 0;
    const abort = rng() < CONFIG.mineAbortP;
    const delayed = take("return", abort ? left : Math.min(1, left));
    if (d === 0 && delayed === 0) take("return", 1);
    const harm = casualtyDraw(rng, d, CONFIG.mineCasP);
    casualties += harm.casualties;
    missing += harm.missing;
    events.push(transitEvent(opts, size, escorted, "mine", Math.max(1, d + delayed), d, harm, rng));
  }

  if (rng() < harP && left > 0) {
    const d = rng() < CONFIG.harDamageP ? take("damage", 1) : 0;
    const delayed = take("return", 1);
    const harm = casualtyDraw(rng, d, CONFIG.harCasP);
    casualties += harm.casualties;
    missing += harm.missing;
    events.push(transitEvent(opts, size, escorted, "harassment", Math.max(1, d + delayed), d, harm, rng));
  }

  if (rng() < gnssP && left > 0) {
    const delayed = take("return", 1);
    events.push(transitEvent(opts, size, escorted, "gnss", delayed, 0, { casualties: 0, missing: 0 }, rng));
  }

  if (rng() < congP && left > 0) {
    const d = rng() < 0.45 ? take("damage", 1) : 0;
    const delayed = take("return", rng() < 0.5 ? Math.min(2, left) : 0);
    const harm = casualtyDraw(rng, d, 0.02);
    casualties += harm.casualties;
    missing += harm.missing;
    events.push(transitEvent(opts, size, escorted, "congestion", Math.max(1, d + delayed), d, harm, rng));
  }

  return { arrived: left, returned, damaged, casualties, missing, events };
}

function transitEvent(
  opts: LaneOpts,
  convoy: number,
  escorted: boolean,
  kind: IncidentKind,
  affected: number,
  damaged: number,
  harm: { casualties: number; missing: number },
  rng: Rng,
): TrueEvent {
  void rng;
  const who = opts.programme ? "A programme ship" : "A ship outside your programme";
  const where = zoneName(opts.zone);
  const escortText = escorted ? "inside an escort screen" : "with no escort on that group";
  let summary = `${who} reported ${kindNoun(kind)} in the ${where}, ${escortText}.`;
  if (damaged > 0) summary += ` Hulls damaged: ${damaged}.`;
  else summary += " No hull damage in the record.";
  if (harm.casualties > 0) {
    summary += ` Crew casualties: ${harm.casualties}.`;
    if (harm.missing > 0) summary += ` Of those, missing: ${harm.missing}.`;
  } else summary += " Crew accounted for.";
  const event = makeEvent(opts.state, {
    day: opts.day,
    zone: opts.zone,
    kind,
    programme: opts.programme,
    shipsAffected: affected,
    shipsDamaged: damaged,
    casualties: harm.casualties,
    missing: harm.missing,
    flowLostMb: (damaged + Math.max(0, affected - damaged)) * CONFIG.shipMb,
    escorted,
    convoySize: convoy,
    summary,
  });
  if (damaged > 0 && damagingKind(kind)) {
    event.damage = assessHit(opts.seed, event.id, kind);
    event.summary = playerCable(event.damage, event.damage.early, {
      casualties: harm.casualties,
      missing: harm.missing,
    });
  }
  return event;
}

function casualtyDraw(rng: Rng, damaged: number, casP: number): { casualties: number; missing: number } {
  if (damaged <= 0 || rng() >= casP) return { casualties: 0, missing: 0 };
  let casualties = 1 + sampleNegBin(rng, CONFIG.extraCasualtyMean, CONFIG.extraCasualtyK);
  casualties = Math.min(CONFIG.maxCasualtiesPerIncident, casualties);
  let missing = 0;
  if (rng() < CONFIG.missingGivenCasualtyP) missing = 1;
  if (missing > casualties) missing = casualties;
  return { casualties, missing };
}

function makeEvent(state: Internal, fields: Omit<TrueEvent, "id">): TrueEvent {
  const id = `e${state.seqE}`;
  state.seqE += 1;
  return { id, ...fields };
}

function fileReports(seed: string, state: Internal, world: World, day: number, events: TrueEvent[]): void {
  for (const event of events) {
    if (event.kind === "pipeline") continue;
    const rng = rngFor(seed, `rep|${event.id}`);
    const made: Report[] = [];
    if (shouldLiaison(event, rng)) made.push(buildReport(state, event, "liaison", rng, false, false));
    if (rng() < ukmtoP(event.kind)) {
      const late = rng() < CONFIG.reports.ukmtoLateP;
      const misloc = rng() < CONFIG.reports.ukmtoMislocP;
      made.push(buildReport(state, event, "ukmto", rng, late, misloc));
    }
    if (THREAT.has(event.kind) && rng() < CONFIG.reports.stateP) {
      made.push(buildReport(state, event, "state", rng, false, rng() < CONFIG.reports.stateMislocP));
    }
    if ((THREAT.has(event.kind) || event.kind === "gnss") && rng() < CONFIG.reports.anonP) {
      made.push(buildReport(state, event, "anon", rng, false, rng() < 0.45));
    }
    world.reports.push(...made);
    for (const original of made) {
      if (original.source === "anon") continue;
      if (rng() < CONFIG.reports.pressDupP) {
        world.reports.push(restatement(state, original, rngFor(seed, `press|${original.id}`)));
      }
    }
  }

  const fabRng = rngFor(seed, `fabricate|${day}`);
  if (fabRng() < CONFIG.reports.stateFabricateP) world.reports.push(fabrication(state, day, "state", fabRng));
  if (fabRng() < CONFIG.reports.anonFabricateP) world.reports.push(fabrication(state, day, "anon", fabRng));

  const runRng = rngFor(seed, `running|${day}`);
  if (day >= 1 && runRng() < CONFIG.reports.pressRunningP) {
    const windowStart = day - 6;
    const inWindow = world.events.filter(
      (event) => event.day >= windowStart && event.day <= day && THREAT.has(event.kind),
    );
    if (inWindow.length >= 1) {
      const zones = new Set(inWindow.map((event) => event.zone));
      const trueZone = zones.size === 1 ? inWindow[0].zone : undefined;
      const claimed = inWindow.length;
      const id = takeReportId(state);
      world.reports.push({
        id,
        filedDay: clampFile(day + CONFIG.reports.minLatency),
        allegedDay: Math.max(day, 1),
        source: "press",
        zone: trueZone ?? "unspecified",
        kind: "security",
        claimedCount: claimed,
        text: reportText({
          source: "press",
          kind: "security",
          zone: trueZone ?? "unspecified",
          claimed,
          allegedDay: Math.max(day, 1),
          late: false,
          runningTotal: true,
          casualties: 0,
          variant: Math.floor(runRng() * 3),
          windowDays: 7,
        }),
        damageReport: false,
        truth: {
          realEventIds: inWindow.map((event) => event.id),
          fabricated: false,
          runningTotal: true,
          mislocated: false,
          inflated: false,
          lateFiled: false,
          restatement: false,
          trueCount: inWindow.length,
          trueZone,
        },
      });
    }
  }
}

function shouldLiaison(event: TrueEvent, rng: Rng): boolean {
  const serious = event.shipsDamaged > 0 || event.casualties > 0 || event.kind === "mine" || event.kind === "security";
  if (!serious || event.kind === "pipeline" || event.kind === "congestion" || event.kind === "gnss") return false;
  const p = event.programme ? CONFIG.reports.liaisonProgrammeP : CONFIG.reports.liaisonBackgroundP;
  return rng() < p;
}

function ukmtoP(kind: IncidentKind): number {
  return CONFIG.reports.ukmtoP[kind];
}

function buildReport(
  state: Internal,
  event: TrueEvent,
  source: Report["source"],
  rng: Rng,
  late: boolean,
  misloc: boolean,
): Report {
  let zone: Zone | "unspecified" = event.zone;
  if (source === "anon" && rng() < 0.4) zone = "unspecified";
  else if (misloc) zone = NEIGHBOR[event.zone][Math.floor(rng() * NEIGHBOR[event.zone].length)];
  let claimed = 1;
  let inflated = false;
  let kind = event.kind;
  if (source === "state") {
    kind = event.kind === "gnss" || event.kind === "harassment" ? "security" : event.kind;
    if (rng() < CONFIG.reports.stateInflateP) {
      claimed = 1 + 1 + Math.floor(rng() * CONFIG.reports.stateInflateExtra);
      inflated = true;
    }
  }
  const latency = late ? CONFIG.reports.lateLatency : CONFIG.reports.minLatency;
  const filedDay = clampFile(event.day + latency);
  const id = takeReportId(state);
  const variant = Math.floor(rng() * 3);
  const damage = event.damage;
  const crew = source === "liaison" ? { casualties: event.casualties, missing: event.missing } : null;
  const text = damage
    ? damageDispatch({
        source,
        zone,
        claimed,
        allegedDay: event.day,
        late,
        variant,
        cable: playerCable(damage, stageFor(event.day, filedDay) === "full" ? damage.full : damage.early, crew),
      })
    : reportText({
        source,
        kind,
        zone,
        claimed,
        allegedDay: event.day,
        late,
        runningTotal: false,
        casualties: source === "liaison" ? event.casualties : 0,
        variant,
      });
  return {
    id,
    filedDay,
    allegedDay: event.day,
    source,
    zone,
    kind,
    claimedCount: claimed,
    text,
    damageReport: damage != null,
    truth: {
      realEventIds: [event.id],
      fabricated: false,
      runningTotal: false,
      mislocated: zone !== "unspecified" && zone !== event.zone,
      inflated,
      lateFiled: late || filedDay - event.day > 2,
      restatement: false,
      trueCount: 1,
      trueZone: event.zone,
    },
  };
}

function restatement(state: Internal, original: Report, rng: Rng): Report {
  let zone = original.zone;
  let mislocated = original.truth.mislocated;
  if (original.zone !== "unspecified" && rng() < 0.2) {
    zone = NEIGHBOR[original.zone][Math.floor(rng() * NEIGHBOR[original.zone].length)];
    mislocated = true;
  }
  const id = takeReportId(state);
  const variant = Math.floor(rng() * 3);
  return {
    id,
    filedDay: clampFile(original.filedDay + (rng() < 0.7 ? 0 : 1)),
    allegedDay: original.allegedDay,
    source: "press",
    zone,
    kind: original.kind,
    claimedCount: original.claimedCount,
    damageReport: original.damageReport,
    text: original.damageReport
      ? damageRestatement(original.text, variant)
      : reportText({
          source: "press",
          kind: original.kind,
          zone,
          claimed: original.claimedCount,
          allegedDay: original.allegedDay,
          late: false,
          runningTotal: false,
          casualties: 0,
          variant,
        }),
    truth: {
      realEventIds: [...original.truth.realEventIds],
      fabricated: original.truth.fabricated,
      duplicateOfReportId: original.id,
      runningTotal: false,
      mislocated,
      inflated: original.truth.inflated,
      lateFiled: false,
      restatement: true,
      trueCount: original.truth.trueCount,
      trueZone: original.truth.trueZone,
    },
  };
}

function fabrication(state: Internal, day: number, source: "state" | "anon", rng: Rng): Report {
  const zones: Zone[] = ["gulf", "strait", "oman", "bab"];
  const zone = zones[Math.floor(rng() * zones.length)];
  const kind: IncidentKind = rng() < 0.7 ? "security" : "mine";
  const claimed = source === "state" ? 1 + Math.floor(rng() * 4) : 1;
  const id = takeReportId(state);
  const allegedDay = Math.max(day, 0);
  return {
    id,
    filedDay: clampFile(day + CONFIG.reports.minLatency),
    allegedDay,
    source,
    zone,
    kind,
    claimedCount: claimed,
    damageReport: false,
    text: reportText({
      source,
      kind,
      zone,
      claimed,
      allegedDay,
      late: false,
      runningTotal: false,
      casualties: 0,
      variant: Math.floor(rng() * 3),
    }),
    truth: {
      realEventIds: [],
      fabricated: true,
      runningTotal: false,
      mislocated: false,
      inflated: claimed > 1,
      lateFiled: false,
      restatement: false,
      trueCount: 0,
    },
  };
}

function fileRelease(seed: string, state: Internal, world: World, day: number, filedDay: number): void {
  const toDay = day;
  const fromDay = Math.max(1, toDay - 6);
  const rows = world.days.filter((record) => record.day >= fromDay && record.day <= toDay);
  if (rows.length === 0) return;
  const trueMean = rows.reduce((sum, record) => sum + record.straitFlowMb, 0) / rows.length;
  const rng = rngFor(seed, `release|${filedDay}`);
  const printed = Math.max(0, round1(trueMean + CONFIG.releaseNoiseMb * sampleNormal(rng)));
  const confirmThrough = toDay - CONFIG.bulletinLagDays;
  const confirmable = world.events.filter(
    (event) =>
      event.day >= fromDay &&
      event.day <= confirmThrough &&
      event.day >= 1 &&
      THREAT.has(event.kind),
  );
  const confirmedIds: string[] = [];
  for (const event of confirmable) {
    const include = rngFor(seed, `jmic|${event.id}`)();
    if (include < CONFIG.reports.jmicIncludeP) {
      confirmedIds.push(event.id);
      const late = filedDay - event.day > 3;
      const reportRng = rngFor(seed, `jmic-text|${event.id}`);
      const id = takeReportId(state);
      const variant = Math.floor(reportRng() * 3);
      const damage = event.damage;
      const text = damage
        ? damageDispatch({
            source: "jmic",
            zone: event.zone,
            claimed: 1,
            allegedDay: event.day,
            late,
            variant,
            cable: playerCable(damage, stageFor(event.day, filedDay) === "full" ? damage.full : damage.early, null),
          })
        : reportText({
            source: "jmic",
            kind: event.kind,
            zone: event.zone,
            claimed: 1,
            allegedDay: event.day,
            late,
            runningTotal: false,
            casualties: 0,
            variant,
          });
      world.reports.push({
        id,
        filedDay,
        allegedDay: event.day,
        source: "jmic",
        zone: event.zone,
        kind: event.kind,
        claimedCount: 1,
        damageReport: damage != null,
        text,
        truth: {
          realEventIds: [event.id],
          fabricated: false,
          runningTotal: false,
          mislocated: false,
          inflated: false,
          lateFiled: late,
          restatement: false,
          trueCount: 1,
          trueZone: event.zone,
        },
      });
    }
  }
  world.releases.push({
    id: `rel-${filedDay}`,
    filedDay,
    fromDay,
    toDay,
    printedMbPerDay: printed,
    trueMeanMbPerDay: round1(trueMean),
    confirmedIncidentIds: confirmedIds,
  });
}

function operatorNotes(input: {
  decision: Decisions;
  programmeShips: number;
  escortedWant: number;
  unescortedGo: number;
  arrived: number;
  returned: number;
  damaged: number;
  casualties: number;
  missing: number;
  programmeFlow: number;
  fujAsked: number;
  fujFlow: number;
  fujOutage: boolean;
  yanbuAsked: number;
  yanbuFlow: number;
  yanbuOutage: boolean;
  southShips: number;
  babDamaged: number;
  babReturned: number;
  suezSlip: number;
  backlog: number;
  shutInShips: number;
  straitSlowMb: number;
  straitAnchorReturns: number;
  fujSlowMb: number;
  babSlowMb: number;
  damageCables: boolean;
}): string[] {
  const notes: string[] = [];
  const crew =
    input.casualties > 0
      ? `Crew casualties on programme ships: ${input.casualties}${input.missing > 0 ? `, of which missing ${input.missing}` : ""}.`
      : "No crew casualties on programme ships.";
  const cable = input.damageCables
    ? " Hull damage is in the damage cable. It describes what was seen and does not name a weapon."
    : "";
  notes.push(
    `Programme Strait call: ${input.programmeShips} sailed (${input.escortedWant} escorted, ${input.unescortedGo} unescorted). Arrived ${input.arrived}, returned to anchor ${input.returned}, hulls damaged ${input.damaged}. ${crew}${cable}`,
  );
  const slow =
    input.straitSlowMb > 0
      ? ` Includes ${oneDecimal(input.straitSlowMb)} mb from damaged ships that could proceed slowly.`
      : "";
  notes.push(
    `Oil your programme got through the Strait: ${oneDecimal(input.programmeFlow)} mb.${slow} That is not the theatre total. Other ships sail this lane and do not cable you.`,
  );
  const fujSlow = input.fujSlowMb > 0 ? ` ${oneDecimal(input.fujSlowMb)} mb of that moved on a ship that could proceed slowly.` : "";
  notes.push(
    (input.fujOutage
      ? `Fujairah line accepted ${oneDecimal(input.fujFlow)} mb of ${oneDecimal(input.fujAsked)} mb nominated. The operator reports a station outage. Cause not established. No crew casualty is carried for the outage.`
      : `Fujairah line accepted ${oneDecimal(input.fujFlow)} mb of ${oneDecimal(input.fujAsked)} mb nominated.`) + fujSlow,
  );
  const bab =
    input.southShips > 0
      ? ` Southbound loadings: ${input.southShips}. Bab damage ${input.babDamaged}, Bab turn-backs ${input.babReturned}.`
      : " No southbound Yanbu loading today, so nothing of yours passed Bab al-Mandab.";
  const babSlow = input.babSlowMb > 0 ? ` ${oneDecimal(input.babSlowMb)} mb still moved on a ship that could proceed slowly.` : "";
  const suez = input.suezSlip > 0.05 ? ` Northbound cargo of ${oneDecimal(input.suezSlip)} mb slipped a day on the Suez queue.` : "";
  notes.push(
    (input.yanbuOutage
      ? `Yanbu line accepted ${oneDecimal(input.yanbuFlow)} mb against a nomination of ${oneDecimal(input.yanbuAsked)} mb, restricted by a station outage.`
      : `Yanbu line moved ${oneDecimal(input.yanbuFlow)} mb (nomination ${oneDecimal(input.yanbuAsked)} mb).`) +
      bab +
      babSlow +
      suez,
  );
  const towed =
    input.straitAnchorReturns > 0
      ? ` ${input.straitAnchorReturns} damaged programme ship${input.straitAnchorReturns === 1 ? " is" : "s are"} back at anchor, disabled or under tow.`
      : "";
  notes.push(
    input.shutInShips > 0
      ? `Ships at anchor after the day's movements: ${input.backlog}. The anchorage is full, so ${input.shutInShips} loadings were shut in and did not move.${towed}`
      : `Ships at anchor after the day's movements: ${input.backlog}.${towed}`,
  );
  notes.push(
    `Public line you issued: ${messageLabel(input.decision.message)}. Guidance you gave owners: ${guidanceLabel(input.decision.guidance)}. A quiet programme cable is not a quiet theatre.`,
  );
  return notes;
}

function clampFile(day: number): number {
  return Math.max(1, Math.min(CONFIG.days + 1, day));
}

function takeReportId(state: Internal): string {
  const id = `r${state.seqR}`;
  state.seqR += 1;
  return id;
}

function chunk(count: number, size: number): number[] {
  const out: number[] = [];
  let left = Math.max(0, Math.floor(count));
  const group = Math.max(1, Math.floor(size));
  while (left > 0) {
    const n = Math.min(group, left);
    out.push(n);
    left -= n;
  }
  return out;
}

function fractionalShips(rng: Rng, exact: number): number {
  if (!(exact > 0)) return 0;
  const wholeShips = Math.floor(exact);
  return wholeShips + (rng() < exact - wholeShips ? 1 : 0);
}

function kindNoun(kind: IncidentKind): string {
  switch (kind) {
    case "mine":
      return "a mine contact";
    case "harassment":
      return "harassment";
    case "security":
      return "a security incident";
    case "gnss":
      return "GNSS interference";
    case "congestion":
      return "a congestion mishap";
    case "pipeline":
      return "a pipeline outage";
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

export function threatKinds(): ReadonlySet<IncidentKind> {
  return THREAT;
}
