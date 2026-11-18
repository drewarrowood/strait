import { CONFIG } from "../src/config";
import { BASELINE, CAUTIOUS, RECKLESS, UNSWEPT } from "../src/decide";
import { presentMorning } from "../src/present";
import { projectPlan } from "../src/project";
import { questionForMorning } from "../src/questions";
import { mulberry32, quantile, sampleNegBin } from "../src/rng";
import { buildScorecard, detectMistakes, gradeLedger } from "../src/score";
import { simulate, summarize, utilityOf } from "../src/model";
import type { Decisions, ForecastAnswer, LedgerMark, Report, TrueEvent, World } from "../src/types";

let failed = 0;

function check(cond: boolean, message: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${message}`);
  }
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

function seeds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `seed-${i + 1}`);
}

function repeat(decision: Decisions, days = CONFIG.days): Decisions[] {
  return Array.from({ length: days }, () => decision);
}

function median(values: number[]): number {
  return quantile(values, 0.5);
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);
}

function assertWorldSane(world: World, label: string): void {
  check(world.days.length === CONFIG.days, `${label}: expected ${CONFIG.days} days, got ${world.days.length}`);
  for (const day of world.days) {
    check(day.straitFlowMb >= 0 && day.straitFlowMb <= 36, `${label} day ${day.day} strait flow ${day.straitFlowMb}`);
    check(day.systemFlowMb >= 0 && day.systemFlowMb <= 42, `${label} day ${day.day} system flow ${day.systemFlowMb}`);
    check(day.fujFlowMb >= -0.05 && day.fujFlowMb <= CONFIG.fujairahCapacityMb + 0.2, `${label} fuj ${day.fujFlowMb}`);
    check(day.yanbuFlowMb >= -0.05 && day.yanbuFlowMb <= CONFIG.yanbuCapacityMb + 4, `${label} yanbu ${day.yanbuFlowMb}`);
    check(day.backlogShips >= 0 && day.backlogShips <= 40, `${label} backlog ${day.backlogShips}`);
    check(day.priceIndex >= 40 && day.priceIndex <= 240, `${label} price ${day.priceIndex}`);
    check(day.pressure >= 0 && day.pressure <= 100, `${label} pressure ${day.pressure}`);
    check(day.posture > 0 && day.posture < 1, `${label} posture ${day.posture}`);
    check(day.mineStrait >= 0 && day.mineStrait <= CONFIG.mineCap + 0.01, `${label} mine ${day.mineStrait}`);
    check(day.programmeArrived <= day.programmeAttempted, `${label} arrived > attempted`);
    check(day.programmeMissing <= day.programmeCasualties, `${label} missing > casualties`);
    check(day.missingToday <= day.casualtiesToday, `${label} day missing`);
    for (const key of ["straitFlowMb", "systemFlowMb", "priceIndex", "pressure", "posture"] as const) {
      check(finite(day[key]), `${label} non-finite ${key}`);
    }
  }
  const totals = summarize(world);
  check(totals.totalDamage >= 0 && totals.totalDamage < 80, `${label} damage ${totals.totalDamage}`);
  check(totals.totalCasualties >= 0 && totals.totalCasualties < 50, `${label} casualties ${totals.totalCasualties}`);
  check(totals.totalMissing <= totals.totalCasualties, `${label} missing total`);
  check(world.reports.length < 400, `${label} report explosion ${world.reports.length}`);
  for (const report of world.reports) {
    check(report.claimedCount >= 0 && report.claimedCount <= 40, `${label} claim ${report.id} ${report.claimedCount}`);
    check(report.filedDay >= 1 && report.filedDay <= CONFIG.days + 1, `${label} filedDay ${report.filedDay}`);
    check(report.text.length > 20, `${label} empty text ${report.id}`);
  }
}

function mineCount(world: World): number {
  return world.events.filter((event) => event.kind === "mine" && event.zone === "strait" && event.day >= 1).length;
}

function runPolicies(): void {
  const list = seeds(16);
  const policies: Array<[string, Decisions]> = [
    ["baseline", BASELINE],
    ["cautious", CAUTIOUS],
    ["reckless", RECKLESS],
    ["unswept", UNSWEPT],
  ];
  const stats: Record<string, { damage: number[]; strait: number[]; cas: number[]; util: number[]; mines: number[]; flowHit: number; incidentHit: number; releaseAbove: number; releaseTotal: number }> = {};
  for (const [name, decision] of policies) {
    const bucket = {
      damage: [] as number[],
      strait: [] as number[],
      cas: [] as number[],
      util: [] as number[],
      mines: [] as number[],
      flowHit: 0,
      incidentHit: 0,
      releaseAbove: 0,
      releaseTotal: 0,
    };
    for (const seed of list) {
      const world = simulate(seed, repeat(decision));
      assertWorldSane(world, `${name}/${seed}`);
      const totals = summarize(world);
      bucket.damage.push(totals.totalDamage);
      bucket.strait.push(totals.meanStraitMb);
      bucket.cas.push(totals.totalCasualties);
      bucket.util.push(utilityOf(totals));
      bucket.mines.push(mineCount(world));
      const releases = world.releases.filter((release) => release.printedMbPerDay >= CONFIG.flowQuestionMb);
      if (releases.length >= 2) bucket.flowHit += 1;
      bucket.releaseAbove += releases.length;
      bucket.releaseTotal += world.releases.length;
      const weeks = [0, 0, 0, 0];
      for (const event of world.events) {
        if (event.day < 1 || (event.zone !== "gulf" && event.zone !== "strait")) continue;
        if (event.kind !== "mine" && event.kind !== "harassment" && event.kind !== "security") continue;
        const index = Math.min(3, Math.floor((event.day - 1) / 7));
        weeks[index] += 1;
      }
      if (weeks.filter((count) => count >= CONFIG.incidentQuestionCount).length >= 2) bucket.incidentHit += 1;
    }
    stats[name] = bucket;
    console.log(
      `${name.padEnd(10)} damage med ${median(bucket.damage).toFixed(1)} (mean ${mean(bucket.damage).toFixed(1)})  ` +
        `cas med ${median(bucket.cas).toFixed(1)} mean ${mean(bucket.cas).toFixed(1)}  ` +
        `strait med ${median(bucket.strait).toFixed(1)}  util mean ${mean(bucket.util).toFixed(1)}  ` +
        `mines mean ${mean(bucket.mines).toFixed(1)}  releases>=line ${bucket.releaseAbove}/${bucket.releaseTotal}  hotWeeks ${bucket.incidentHit}/${list.length}`,
    );
  }
  check(median(stats.reckless.damage) > median(stats.cautious.damage), "reckless should damage more ships than cautious");
  check(median(stats.reckless.strait) > median(stats.cautious.strait), "reckless should move more Strait oil than cautious");
  check(mean(stats.reckless.cas) > mean(stats.cautious.cas), "reckless should have higher mean casualties than cautious");
  check(mean(stats.unswept.mines) > mean(stats.baseline.mines), "leaving the lane unswept should raise Strait mine contacts");
  check(mean(stats.baseline.util) > mean(stats.reckless.util), "baseline utility should beat sailing unescorted");
  check(mean(stats.baseline.util) > mean(stats.cautious.util), "baseline utility should beat hiding almost everything");
  check(stats.baseline.flowHit > 0 && stats.baseline.flowHit < list.length, "baseline flow question should not be trivial");
  check(stats.reckless.incidentHit + stats.cautious.incidentHit > 0, "incident question should sometimes fire");
}

function runDeterminism(): void {
  const a = simulate("shared-seed", repeat(BASELINE));
  const b = simulate("shared-seed", repeat(BASELINE));
  check(
    a.events.map((event) => event.id + event.summary).join("|") === b.events.map((event) => event.id + event.summary).join("|"),
    "same seed and decisions should rebuild the same events",
  );
  check(
    a.reports.map((report) => report.id + report.text).join("|") === b.reports.map((report) => report.id + report.text).join("|"),
    "same seed and decisions should rebuild the same reports",
  );
  const quiet = simulate("shared-seed", repeat(BASELINE), { reports: false });
  check(
    quiet.days.map((day) => day.straitFlowMb).join(",") === a.days.map((day) => day.straitFlowMb).join(","),
    "skipping reports must not change the oil",
  );
  check(quiet.events.map((event) => event.id).join(",") === a.events.map((event) => event.id).join(","), "event ids stable with reports off");
  const other = simulate("other-seed", repeat(BASELINE));
  check(
    other.reports.map((report) => report.text).join("|") !== a.reports.map((report) => report.text).join("|") ||
      other.events.map((event) => event.id).join(",") !== a.events.map((event) => event.id).join(","),
    "a different seed should change the scenario",
  );
}

function runOverdispersion(): void {
  const draws: number[] = [];
  for (let i = 0; i < 2500; i++) draws.push(sampleNegBin(mulberry32(0x9e3779b9 + i * 17), 2, 0.8));
  const avg = mean(draws);
  const variance = mean(draws.map((value) => (value - avg) ** 2));
  console.log(`negbin mean ${avg.toFixed(2)} variance ${variance.toFixed(2)} (Poisson would be ~mean)`);
  check(variance > avg * 1.4, `negative binomial should be overdispersed, var ${variance} mean ${avg}`);
}

function runProjection(): void {
  const cautious = projectPlan(CAUTIOUS, { backlogShips: 6, priceIndex: 104 }, 48, 7);
  const reckless = projectPlan(RECKLESS, { backlogShips: 6, priceIndex: 104 }, 48, 7);
  for (const band of [cautious.straitFlow, cautious.damage, reckless.casualties, reckless.backlog]) {
    check(band.low <= band.median && band.median <= band.high, `band out of order ${JSON.stringify(band)}`);
  }
  check(reckless.damage.median > cautious.damage.median, "projection should show higher damage for the reckless plan");
  console.log(
    `projection damage cautious median ${cautious.damage.median.toFixed(1)} (${cautious.damage.low.toFixed(1)}–${cautious.damage.high.toFixed(1)})  ` +
      `reckless median ${reckless.damage.median.toFixed(1)} (${reckless.damage.low.toFixed(1)}–${reckless.damage.high.toFixed(1)})`,
  );
}

function runMorningPrivacy(): void {
  const world = simulate("privacy", repeat(BASELINE));
  const morning = presentMorning(world, 4);
  const leaked: string[] = [];
  const walk = (value: unknown, path: string) => {
    if (Array.isArray(value)) {
      value.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, inner] of Object.entries(value)) {
        if (key === "truth" || key === "posture" || key === "mineStrait" || key === "fabricated" || key === "trueMeanMbPerDay") {
          leaked.push(`${path}.${key}`);
        }
        walk(inner, `${path}.${key}`);
      }
    }
  };
  walk(morning, "morning");
  check(leaked.length === 0, `morning view leaked hidden fields: ${leaked.join(", ")}`);
  check(morning.newReports.every((report) => morning.reports.some((item) => item.id === report.id)), "new reports should be part of the book");
}

function runForecasts(): void {
  const decisions: Decisions[] = [];
  const forecasts: ForecastAnswer[] = [];
  for (let day = 1; day <= CONFIG.days; day++) {
    const soFar = simulate("forecast-seed", decisions);
    const question = questionForMorning(soFar, day);
    if (question) forecasts.push({ question, probability: 0.55 });
    decisions.push({ ...BASELINE });
  }
  check(forecasts.length === CONFIG.questions.length, `expected ${CONFIG.questions.length} questions, got ${forecasts.length}`);
  const world = simulate("forecast-seed", decisions);
  const card = buildScorecard(world, decisions, {}, forecasts, 24);
  check(card.brier != null && card.brier >= 0 && card.brier <= 1, `brier ${card.brier}`);
  check(card.logScore != null && card.logScore <= 0, `log score ${card.logScore}`);
  check(card.forecasts.every((answer) => answer.outcome === 0 || answer.outcome === 1), "every forecast should resolve");
  check(card.judgment >= 0 && card.judgment <= 100, `judgment ${card.judgment}`);
  check(card.playerDamage.length === 24 && card.playerDamage.every((n) => n >= 0 && n < 80), "replay damage left the sane range");
  const ordered = card.playerSystem.slice().sort((a, b) => a - b);
  check(quantile(ordered, 0.05) <= quantile(ordered, 0.5) && quantile(ordered, 0.5) <= quantile(ordered, 0.95), "replay percentiles");
  console.log(
    `scorecard brier ${card.brier?.toFixed(3)} log ${card.logScore?.toFixed(3)} judgment ${card.judgment.toFixed(1)} ` +
      `ledger ${card.ledger.points.toFixed(0)} ops ${card.operationalPoints.toFixed(1)} mistakes ${card.mistakes.length}`,
  );
}

function eventFixture(partial: Partial<TrueEvent> & Pick<TrueEvent, "id" | "zone" | "kind">): TrueEvent {
  return {
    day: 4,
    programme: false,
    shipsAffected: 1,
    shipsDamaged: 0,
    casualties: 0,
    missing: 0,
    flowLostMb: 0,
    escorted: false,
    convoySize: 2,
    summary: "fixture",
    ...partial,
  };
}

function reportFixture(partial: Partial<Report> & Pick<Report, "id">): Report {
  return {
    filedDay: 5,
    allegedDay: 4,
    source: "ukmto",
    zone: "strait",
    kind: "security",
    claimedCount: 1,
    text: "fixture report",
    damageReport: false,
    truth: {
      realEventIds: ["e1"],
      fabricated: false,
      runningTotal: false,
      mislocated: false,
      inflated: false,
      lateFiled: false,
      restatement: false,
      trueCount: 1,
      trueZone: "strait",
    },
    ...partial,
  };
}

function runMistakeFixtures(): void {
  const events = [
    eventFixture({ id: "e1", zone: "strait", kind: "security", programme: false }),
    eventFixture({ id: "e2", zone: "bab", kind: "mine", programme: true, day: 6 }),
  ];
  const running = reportFixture({
    id: "r-run",
    source: "press",
    claimedCount: 7,
    truth: {
      realEventIds: ["e1"],
      fabricated: false,
      runningTotal: true,
      mislocated: false,
      inflated: false,
      lateFiled: false,
      restatement: false,
      trueCount: 7,
      trueZone: "strait",
    },
  });
  const gulfClaim = reportFixture({
    id: "r-gulf",
    zone: "gulf",
    truth: {
      realEventIds: ["e9"],
      fabricated: false,
      runningTotal: false,
      mislocated: false,
      inflated: false,
      lateFiled: false,
      restatement: false,
      trueCount: 1,
      trueZone: "gulf",
    },
  });
  const babClaim = reportFixture({
    id: "r-bab",
    zone: "bab",
    truth: {
      realEventIds: ["e2"],
      fabricated: false,
      runningTotal: false,
      mislocated: false,
      inflated: false,
      lateFiled: false,
      restatement: false,
      trueCount: 1,
      trueZone: "bab",
    },
  });
  const marks: Record<string, LedgerMark> = {
    "r-run": { reportId: "r-run", disposition: "confirm", confirmCount: 7, reviewed: true },
    "r-gulf": { reportId: "r-gulf", disposition: "merge", mergeTargetId: "r-bab", reviewed: true },
  };
  const world = {
    seed: "fixture",
    events,
    reports: [running, gulfClaim, babClaim],
    releases: [{ id: "rel-8", filedDay: 8, fromDay: 1, toDay: 7, printedMbPerDay: 12, trueMeanMbPerDay: 12, confirmedIncidentIds: [] }],
    days: [],
    opening: { backlogShips: 4, priceIndex: 100, pressure: 10 },
  } as World;
  const forecasts: ForecastAnswer[] = [
    {
      question: {
        id: "q-inc-test",
        askedDay: 11,
        kind: "incidents",
        text: "incidents will clear the bar",
        detail: "",
        threshold: 2,
        windowStart: 11,
        windowEnd: 17,
        sealed: true,
      },
      probability: 0.05,
      outcome: 1,
    },
  ];
  const mistakes = detectMistakes(world, [], marks, forecasts);
  const texts = mistakes.map((mistake) => mistake.text);
  check(texts.some((text) => text.startsWith("You counted a running total as a daily count")), "running-total phrase");
  check(texts.some((text) => text.startsWith("You merged two claims with different locations")), "location-merge phrase");
  check(texts.some((text) => text.startsWith("You shelved a question after one low reading")), "shelving phrase");

  const quietDecisions = repeat(RECKLESS);
  const hit = eventFixture({
    id: "e-hit",
    day: 12,
    zone: "strait",
    kind: "mine",
    programme: true,
    shipsDamaged: 1,
  });
  const quietWorld = {
    ...world,
    events: [hit],
    reports: [],
    days: [],
    releases: [],
  } as World;
  const quietMistakes = detectMistakes(quietWorld, quietDecisions, {}, []);
  check(
    quietMistakes.some((mistake) => mistake.text.startsWith("You treated a missing report as proof nothing happened")),
    "missing-report phrase",
  );

  const ledger = gradeLedger(world, {
    "r-run": { reportId: "r-run", disposition: "exclude", reviewed: true },
  });
  check(ledger.rows.find((row) => row.reportId === "r-run")?.grade === "right", "excluding a running total should be right");
}

function runIntegratedTrap(): void {
  let found = false;
  for (const seed of seeds(12)) {
    const world = simulate(seed, repeat(BASELINE));
    const running = world.reports.find((report) => report.truth.runningTotal);
    if (!running) continue;
    const marks = {
      [running.id]: { reportId: running.id, disposition: "confirm" as const, confirmCount: running.claimedCount, reviewed: true },
    };
    const mistakes = detectMistakes(world, repeat(BASELINE), marks, []);
    check(
      mistakes.some((mistake) => mistake.text.startsWith("You counted a running total as a daily count")),
      "integrated running total should be named",
    );
    found = true;
    break;
  }
  check(found, "expected at least one running-total report in 12 baseline seeds");
  let openings = 0;
  for (const seed of seeds(12)) {
    const world = simulate(seed, []);
    openings += presentMorning(world, 1).reports.length;
  }
  console.log(`opening reports across 12 empty campaigns: ${openings}`);
  check(openings >= 8, "the pre-desk watch should usually leave an inbox");
}

console.log("Strait simulation check");
runOverdispersion();
runDeterminism();
runPolicies();
runProjection();
runMorningPrivacy();
runMistakeFixtures();
runIntegratedTrap();
runForecasts();

if (failed > 0) {
  throw new Error(`${failed} check(s) failed`);
}
console.log("All simulation checks passed.");
