import { CONFIG } from "./config";
import { gradeDamageCalls, type DamageGrade } from "./damage";
import { BASELINE } from "./decide";
import { judgmentWord, oneDecimal, whole } from "./format";
import { dayLabel, zoneName } from "./labels";
import { simulate, summarize, utilityOf, type CampaignTotals } from "./model";
import { tryResolve } from "./questions";
import { bandOf } from "./project";
import { clamp } from "./rng";
import type { Decisions, ForecastAnswer, ForecastQuestion, LedgerMark, Report, TrueEvent, WeaponTag, World } from "./types";

export interface Mistake {
  id: string;
  text: string;
}

export type Grade = "right" | "wrong" | "abstain";

export interface LedgerRow {
  reportId: string;
  grade: Grade;
  belief: string;
  truth: string;
}

export interface LedgerScore {
  right: number;
  wrong: number;
  abstain: number;
  accuracy: number | null;
  points: number;
  rows: LedgerRow[];
}

export interface CalibrationBin {
  label: string;
  low: number;
  high: number;
  n: number;
  meanP: number;
  frequency: number;
}

export interface Scorecard {
  brier: number | null;
  logScore: number | null;
  forecastPoints: number;
  ledger: LedgerScore;
  damage: DamageGrade;
  operationalPoints: number;
  judgment: number;
  judgmentLabel: string;
  mistakes: Mistake[];
  calibration: CalibrationBin[];
  forecasts: ForecastAnswer[];
  actual: CampaignTotals;
  actualUtility: number;
  playerUtility: number[];
  baselineUtility: number[];
  playerSystem: number[];
  baselineSystem: number[];
  playerDamage: number[];
  baselineDamage: number[];
  playerCasualties: number[];
  baselineCasualties: number[];
  playerStrait: number[];
  baselineStrait: number[];
  luckNote: string;
  judgmentNote: string;
  distributionNote: string;
}

export function buildScorecard(
  world: World,
  decisions: readonly Decisions[],
  marks: Readonly<Record<string, LedgerMark>>,
  forecasts: readonly ForecastAnswer[],
  samples = CONFIG.replaySamples,
  weaponTags: Readonly<Record<string, WeaponTag>> = {},
): Scorecard {
  const resolved = forecasts.map((answer) => {
    const outcome = tryResolve(answer.question, world);
    return outcome == null ? answer : { ...answer, outcome };
  });
  const gradedForecasts = resolved.filter((answer): answer is ForecastAnswer & { outcome: 0 | 1 } => answer.outcome === 0 || answer.outcome === 1);
  const brier = gradedForecasts.length
    ? gradedForecasts.reduce((sum, answer) => sum + (answer.probability - answer.outcome) ** 2, 0) / gradedForecasts.length
    : null;
  const logScore = gradedForecasts.length
    ? gradedForecasts.reduce((sum, answer) => {
        const p = clamp(answer.probability, CONFIG.logClamp, 1 - CONFIG.logClamp);
        return sum + (answer.outcome === 1 ? Math.log(p) : Math.log(1 - p));
      }, 0) / gradedForecasts.length
    : null;
  const forecastPoints = brier == null ? 0 : clamp(1 - brier / CONFIG.brierReference, 0, 1) * 100;
  const ledger = gradeLedger(world, marks);
  const damage = gradeDamageCalls(world.events, world.reports, weaponTags, CONFIG.days + 1);
  const replay = replayPolicies(world.seed, decisions, samples);
  const operationalPoints = operationalScore(replay.playerUtility, replay.baselineUtility);
  const w = judgmentWeights(damage.points != null);
  const judgment =
    w.forecast * forecastPoints + w.ledger * ledger.points + w.operational * operationalPoints + w.damage * (damage.points ?? 0);
  const actual = summarize(world);
  const actualUtility = utilityOf(actual);
  const mistakes = detectMistakes(world, decisions, marks, resolved);
  return {
    brier,
    logScore,
    forecastPoints,
    ledger,
    damage,
    operationalPoints,
    judgment,
    judgmentLabel: judgmentWord(judgment),
    mistakes,
    calibration: calibrate(gradedForecasts),
    forecasts: resolved,
    actual,
    actualUtility,
    ...replay,
    luckNote: luckParagraph(actualUtility, replay.playerUtility, actual),
    judgmentNote: judgmentParagraph(replay.playerUtility, replay.baselineUtility),
    distributionNote:
      "Each replay plays your exact daily decisions on a new seed. Where you changed course because of a report, the replay still changes course on that day, even if that seed's reports differ. It tests the decision sequence, not a rule that would have read the other seed's inbox. The operational grade uses the mean across those seeds, so a fat tail of casualties counts even when the median looks acceptable.",
  };
}

export function gradeLedger(world: World, marks: Readonly<Record<string, LedgerMark>>): LedgerScore {
  const programme = new Set(world.events.filter((event) => event.programme).map((event) => event.id));
  const firstConfirm = new Map<string, string>();
  const ordered = [...world.reports].sort((a, b) => a.id.localeCompare(b.id));
  for (const report of ordered) {
    const mark = marks[report.id];
    if (!isConfirm(mark) || report.truth.runningTotal || report.truth.fabricated) continue;
    for (const id of novelIds(report, programme)) {
      if (!firstConfirm.has(id)) firstConfirm.set(id, report.id);
    }
  }
  const rows: LedgerRow[] = [];
  let right = 0;
  let wrong = 0;
  let abstain = 0;
  for (const report of ordered) {
    const mark = marks[report.id];
    const grade = gradeOne(report, mark, world, programme, firstConfirm);
    if (grade === "abstain") abstain += 1;
    else if (grade === "right") right += 1;
    else wrong += 1;
    rows.push({
      reportId: report.id,
      grade,
      belief: beliefPhrase(mark, report),
      truth: truthPhrase(report, world.events),
    });
  }
  const accuracy = right + wrong > 0 ? right / (right + wrong) : null;
  return {
    right,
    wrong,
    abstain,
    accuracy,
    points: accuracy == null ? 40 : accuracy * 100,
    rows,
  };
}

export function detectMistakes(
  world: World,
  decisions: readonly Decisions[],
  marks: Readonly<Record<string, LedgerMark>>,
  forecasts: readonly ForecastAnswer[],
): Mistake[] {
  const mistakes: Mistake[] = [];
  const byId = new Map(world.reports.map((report) => [report.id, report]));
  const events = new Map(world.events.map((event) => [event.id, event]));

  for (const report of world.reports) {
    const mark = marks[report.id];
    if (!mark || !mark.reviewed || mark.disposition !== "confirm") continue;
    if (report.truth.runningTotal) {
      mistakes.push({
        id: `rt-${report.id}`,
        text: `You counted a running total as a daily count (${report.id}, filed day ${report.filedDay}, claimed ${report.claimedCount}). The dispatch was a cumulative figure, not a new day's tally.`,
      });
    }
    const count = mark.confirmCount ?? report.claimedCount;
    if (
      report.truth.inflated &&
      !report.truth.runningTotal &&
      !report.truth.fabricated &&
      count >= report.claimedCount &&
      report.claimedCount >= report.truth.trueCount + 2
    ) {
      mistakes.push({
        id: `inf-${report.id}`,
        text: `You confirmed an inflated claim at the number the outlet printed (${report.id} claimed ${report.claimedCount}; the true incident count was ${report.truth.trueCount}).`,
      });
    }
  }

  const seenEvent = new Map<string, string>();
  for (const report of [...world.reports].sort((a, b) => a.id.localeCompare(b.id))) {
    const mark = marks[report.id];
    if (!isConfirm(mark) || report.truth.runningTotal || report.truth.fabricated) continue;
    for (const id of report.truth.realEventIds) {
      const prior = seenEvent.get(id);
      if (prior && prior !== report.id) {
        mistakes.push({
          id: `dup-${prior}-${report.id}`,
          text: `You booked one incident twice (${prior} and ${report.id} both count ${id}). Merge them, or exclude the copy.`,
        });
      } else seenEvent.set(id, report.id);
    }
  }

  for (const report of world.reports) {
    const mark = marks[report.id];
    if (!mark || !mark.reviewed || mark.disposition !== "merge" || !mark.mergeTargetId) continue;
    const other = byId.get(mark.mergeTargetId);
    const event = events.get(mark.mergeTargetId);
    if (other?.truth.trueZone && report.truth.trueZone && other.truth.trueZone !== report.truth.trueZone) {
      const share = report.truth.realEventIds.some((id) => other.truth.realEventIds.includes(id));
      if (!share) {
        mistakes.push({
          id: `loc-${report.id}-${other.id}`,
          text: `You merged two claims with different locations (${report.id} is in the ${zoneName(report.truth.trueZone)}, ${other.id} is in the ${zoneName(other.truth.trueZone)}).`,
        });
      }
    }
    if (event && report.truth.trueZone && event.zone !== report.truth.trueZone) {
      mistakes.push({
        id: `loc-${report.id}-${event.id}`,
        text: `You merged two claims with different locations (${report.id} belongs in the ${zoneName(report.truth.trueZone)}; programme log ${event.id} is in the ${zoneName(event.zone)}).`,
      });
    }
  }

  for (const answer of forecasts) {
    if (answer.outcome !== 1) continue;
    if (answer.question.kind !== "incidents" && answer.question.kind !== "mine") continue;
    if (answer.probability > CONFIG.shelveProbability) continue;
    const quiet = world.releases.some((release) => {
      if (release.filedDay >= answer.question.askedDay) return false;
      if (answer.question.askedDay - release.filedDay > CONFIG.shelveLookbackDays) return false;
      const cards = world.reports.filter((report) => report.source === "jmic" && report.filedDay === release.filedDay);
      return cards.length === 0;
    });
    if (!quiet) continue;
    mistakes.push({
      id: `shelf-${answer.question.id}`,
      text: `You shelved a question after one low reading. After a joint-centre bulletin with nothing confirmed, you put ${Math.round(answer.probability * 100)}% on “${answer.question.text}” The hidden count still cleared the bar.`,
    });
  }

  for (let day = 2; day <= decisions.length; day++) {
    const decision = decisions[day - 1];
    if (!decision) continue;
    if (decision.guidance !== "sail" || decision.escortStrait > 1 || decision.straitAttemptShips < 6) continue;
    const hit = world.events.find(
      (event) =>
        event.day === day &&
        event.programme &&
        event.zone === "strait" &&
        (event.kind === "mine" || event.kind === "security" || event.kind === "harassment"),
    );
    if (!hit) continue;
    const alert = world.reports.some(
      (report) =>
        report.filedDay >= day - 1 &&
        report.filedDay <= day &&
        (report.zone === "strait" || report.zone === "gulf") &&
        (report.kind === "mine" || report.kind === "security" || report.kind === "harassment"),
    );
    if (alert) continue;
    mistakes.push({
      id: `miss-${day}`,
      text: `You treated a missing report as proof nothing happened. On day ${day} the inbox had been quiet on the Strait, and you still sent a large lightly escorted programme through. A ${hit.kind} contact still occurred against that programme.`,
    });
  }

  const ledger = gradeLedger(world, marks);
  for (const row of ledger.rows) {
    if (row.grade !== "wrong") continue;
    const report = byId.get(row.reportId);
    const mark = marks[row.reportId];
    if (!report || !mark || mark.disposition !== "exclude") continue;
    if (report.truth.fabricated || report.truth.runningTotal || report.truth.realEventIds.length === 0) continue;
    const background = report.truth.realEventIds.some((id) => events.get(id)?.programme === false);
    if (!background) continue;
    mistakes.push({
      id: `ex-${report.id}`,
        text: `You excluded a report of a real background incident and never booked it another way (${report.id}, ${zoneName(report.zone)}, filed day ${report.filedDay}).`,
    });
  }

  return dedupe(mistakes);
}

export function beliefPhrase(mark: LedgerMark | undefined, report: Report): string {
  if (!mark || !mark.reviewed || mark.disposition === "hold") return "Held, or never reviewed.";
  if (mark.disposition === "exclude") return "Excluded as not a separate real incident.";
  if (mark.disposition === "confirm") return `Confirmed and booked as ${mark.confirmCount ?? report.claimedCount} incident${(mark.confirmCount ?? report.claimedCount) === 1 ? "" : "s"}.`;
  return `Merged with ${mark.mergeTargetId ?? "nothing selected"}.`;
}

export function truthPhrase(report: Report, events: readonly TrueEvent[]): string {
  if (report.truth.runningTotal) {
    return `Running total of ${report.truth.trueCount} incidents across several days, not a daily count.`;
  }
  if (report.truth.fabricated || report.truth.realEventIds.length === 0) return "Invented. No event sits behind this claim.";
  if (report.truth.restatement || report.truth.duplicateOfReportId) {
    return `Restatement of ${report.truth.duplicateOfReportId ?? "an earlier report"}, not a new incident.`;
  }
  const linked = report.truth.realEventIds
    .map((id) => events.find((event) => event.id === id))
    .filter((event): event is TrueEvent => Boolean(event));
  if (linked.length === 0) return "No matching event in the log.";
  const event = linked[0];
  const bits = [
    `${event.programme ? "Programme" : "Background"} ${event.kind} in the ${zoneName(event.zone)} on ${dayLabel(event.day)}.`,
  ];
  if (report.truth.mislocated) bits.push(`This report named the ${zoneName(report.zone)} instead.`);
  if (report.truth.inflated) bits.push(`The claim said ${report.claimedCount}; the incident count is ${report.truth.trueCount}.`);
  if (report.truth.lateFiled) bits.push("It was filed late.");
  if (linked.length > 1) bits.push(`It also touches ${linked.length - 1} other event${linked.length === 2 ? "" : "s"}.`);
  return bits.join(" ");
}

function gradeOne(
  report: Report,
  mark: LedgerMark | undefined,
  world: World,
  programme: Set<string>,
  firstConfirm: Map<string, string>,
): Grade {
  if (!mark || !mark.reviewed || mark.disposition === "hold") return "abstain";
  if (mark.disposition === "exclude") return gradeExclude(report, programme, firstConfirm);
  if (mark.disposition === "merge") return gradeMerge(report, mark, world);
  return gradeConfirm(report, mark, programme, firstConfirm);
}

function gradeExclude(report: Report, programme: Set<string>, firstConfirm: Map<string, string>): Grade {
  if (report.truth.runningTotal || report.truth.fabricated || report.truth.realEventIds.length === 0) return "right";
  const novel = novelIds(report, programme);
  if (novel.length === 0) return "right";
  if (novel.every((id) => firstConfirm.has(id))) return "right";
  return "wrong";
}

function gradeConfirm(
  report: Report,
  mark: LedgerMark,
  programme: Set<string>,
  firstConfirm: Map<string, string>,
): Grade {
  if (report.truth.runningTotal) return "wrong";
  if (report.truth.fabricated || report.truth.realEventIds.length === 0) return "wrong";
  const novel = novelIds(report, programme);
  if (novel.length === 0) return "wrong";
  if (novel.every((id) => firstConfirm.get(id) !== report.id)) return "wrong";
  const count = mark.confirmCount ?? report.claimedCount;
  return Math.abs(count - novel.length) <= 1 ? "right" : "wrong";
}

function gradeMerge(report: Report, mark: LedgerMark, world: World): Grade {
  if (!mark.mergeTargetId) return "wrong";
  const event = world.events.find((item) => item.id === mark.mergeTargetId);
  if (event) {
    if (report.truth.fabricated || (report.truth.realEventIds.length === 0 && !report.truth.runningTotal)) return "wrong";
    return report.truth.realEventIds.includes(event.id) ? "right" : "wrong";
  }
  const other = world.reports.find((item) => item.id === mark.mergeTargetId);
  if (!other) return "wrong";
  const share = report.truth.realEventIds.some((id) => other.truth.realEventIds.includes(id));
  if (report.truth.runningTotal) return share ? "right" : "wrong";
  if (report.truth.duplicateOfReportId === other.id || other.truth.duplicateOfReportId === report.id) return "right";
  if (report.truth.fabricated || other.truth.fabricated) return share ? "right" : "wrong";
  return share ? "right" : "wrong";
}

function novelIds(report: Report, programme: Set<string>): string[] {
  return report.truth.realEventIds.filter((id) => !programme.has(id));
}

function isConfirm(mark: LedgerMark | undefined): mark is LedgerMark {
  return Boolean(mark && mark.reviewed && mark.disposition === "confirm");
}

function replayPolicies(campaignSeed: string, decisions: readonly Decisions[], samples: number) {
  const playerUtility: number[] = [];
  const baselineUtility: number[] = [];
  const playerSystem: number[] = [];
  const baselineSystem: number[] = [];
  const playerDamage: number[] = [];
  const baselineDamage: number[] = [];
  const playerCasualties: number[] = [];
  const baselineCasualties: number[] = [];
  const playerStrait: number[] = [];
  const baselineStrait: number[] = [];
  const baselineDays = decisions.map(() => BASELINE);
  for (let i = 0; i < samples; i++) {
    const seed = `replay-${campaignSeed}-${i}`;
    const player = summarize(simulate(seed, decisions, { reports: false }));
    const baseline = summarize(simulate(seed, baselineDays, { reports: false }));
    playerUtility.push(utilityOf(player));
    baselineUtility.push(utilityOf(baseline));
    playerSystem.push(player.meanSystemMb);
    baselineSystem.push(baseline.meanSystemMb);
    playerDamage.push(player.totalDamage);
    baselineDamage.push(baseline.totalDamage);
    playerCasualties.push(player.totalCasualties);
    baselineCasualties.push(baseline.totalCasualties);
    playerStrait.push(player.meanStraitMb);
    baselineStrait.push(baseline.meanStraitMb);
  }
  return {
    playerUtility,
    baselineUtility,
    playerSystem,
    baselineSystem,
    playerDamage,
    baselineDamage,
    playerCasualties,
    baselineCasualties,
    playerStrait,
    baselineStrait,
  };
}

/** Weights actually used. A month with no damage cable spreads that weight across the other three. */
export function judgmentWeights(damageScored: boolean): {
  forecast: number;
  ledger: number;
  operational: number;
  damage: number;
} {
  const w = CONFIG.scoreWeights;
  if (damageScored) return { ...w };
  const rest = w.forecast + w.ledger + w.operational;
  return {
    forecast: w.forecast / rest,
    ledger: w.ledger / rest,
    operational: w.operational / rest,
    damage: 0,
  };
}

function operationalScore(player: number[], baseline: number[]): number {
  if (player.length === 0) return 0;
  const delta = mean(player) - mean(baseline);
  return clamp(60 + (delta / CONFIG.utilityScale) * 40, 0, 100);
}

function luckParagraph(actual: number, samples: number[], totals: CampaignTotals): string {
  const band = bandOf(samples);
  const rank = percentileRank(samples, actual);
  const place =
    rank >= 0.9
      ? "This draw was kinder than your own decisions usually are. Do not read the result as proof the policy was safe."
      : rank <= 0.1
        ? "This draw was harsher than your own decisions usually are. The policy's typical result is the band, not this seed."
        : "This draw sat inside the central band of your own decisions. The result is mostly the policy, not an outlier seed.";
  return `Your decision sequence, across ${samples.length} seeds, has a utility median ${oneDecimal(band.median)} (5th–95th ${oneDecimal(band.low)}–${oneDecimal(band.high)}). This seed's utility was ${oneDecimal(actual)}. ${place} This seed delivered system flow averaging ${oneDecimal(totals.meanSystemMb)} mb/d, with ${whole(totals.totalDamage)} ships damaged and ${whole(totals.totalCasualties)} crew casualties. Those three figures are what happened here. The band is what the same decisions do in general.`;
}

function judgmentParagraph(player: number[], baseline: number[]): string {
  const p = bandOf(player);
  const b = bandOf(baseline);
  const delta = mean(player) - mean(baseline);
  const comparison =
    delta > 1
      ? "Across the same seeds, your decisions beat a steady baseline. That shift is judgment. The width of each band is what luck can still do."
      : delta < -1
        ? "Across the same seeds, your decisions did worse than a steady baseline. A kinder seed would not repair the policy."
        : "Across the same seeds, your decisions landed near a steady baseline. The interesting part is the width of the band, not a single lucky month.";
  return `${comparison} Utility of your decisions: median ${oneDecimal(p.median)} (5th–95th ${oneDecimal(p.low)}–${oneDecimal(p.high)}). Baseline utility: median ${oneDecimal(b.median)} (5th–95th ${oneDecimal(b.low)}–${oneDecimal(b.high)}).`;
}

function calibrate(answers: Array<ForecastAnswer & { outcome: 0 | 1 }>): CalibrationBin[] {
  const edges = [0, 0.2, 0.4, 0.6, 0.8, 1];
  const bins: CalibrationBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const low = edges[i];
    const high = edges[i + 1];
    const group = answers.filter((answer) =>
      i === edges.length - 2 ? answer.probability >= low && answer.probability <= high : answer.probability >= low && answer.probability < high,
    );
    const n = group.length;
    bins.push({
      label: `${Math.round(low * 100)}–${Math.round(high * 100)}%`,
      low,
      high,
      n,
      meanP: n ? mean(group.map((answer) => answer.probability)) : 0,
      frequency: n ? mean(group.map((answer) => answer.outcome)) : 0,
    });
  }
  return bins;
}

function percentileRank(samples: number[], value: number): number {
  if (samples.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const sample of samples) {
    if (sample < value) below += 1;
    else if (sample === value) equal += 1;
  }
  return (below + equal * 0.5) / samples.length;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function dedupe(mistakes: Mistake[]): Mistake[] {
  const seen = new Set<string>();
  const out: Mistake[] = [];
  for (const mistake of mistakes) {
    if (seen.has(mistake.id)) continue;
    seen.add(mistake.id);
    out.push(mistake);
  }
  return out;
}

export function emptyAnswers(questions: ForecastQuestion[], probability: number): ForecastAnswer[] {
  return questions.map((question) => ({ question, probability }));
}
