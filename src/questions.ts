import { CONFIG } from "./config";
import { allegedLabel, zoneName } from "./labels";
import { threatKinds } from "./model";
import type { ForecastQuestion, Report, World } from "./types";

export function questionForMorning(world: World, morningDay: number): ForecastQuestion | null {
  const slot = CONFIG.questions.find((item) => item.day === morningDay);
  if (!slot) return null;
  if (slot.kind === "flow" && slot.releaseMorning) {
    const toDay = slot.releaseMorning - 1;
    const fromDay = Math.max(1, toDay - 6);
    return {
      id: `q-flow-${slot.releaseMorning}`,
      askedDay: morningDay,
      kind: "flow",
      text: `The official release on the morning of day ${slot.releaseMorning} will print average Strait flow for days ${fromDay}–${toDay} at or above ${CONFIG.flowQuestionMb.toFixed(1)} mb/d.`,
      detail:
        "The printed figure is the theatre total, including ships you do not schedule, and it carries measurement error. It is not your programme cable. Today's plan is inside the window. This one is revealed when the release is filed.",
      threshold: CONFIG.flowQuestionMb,
      releaseFiledDay: slot.releaseMorning,
      windowStart: fromDay,
      windowEnd: toDay,
      sealed: false,
      revealDay: slot.releaseMorning,
    };
  }
  if (slot.kind === "incidents" && slot.window) {
    const [start, end] = slot.window;
    return {
      id: `q-inc-${start}`,
      askedDay: morningDay,
      kind: "incidents",
      text: `True mine, harassment, and security incidents in the Arabian Gulf and the Strait, on days ${start} through ${end}, will number at least ${CONFIG.incidentQuestionCount}.`,
      detail:
        "GNSS interference, congestion mishaps, and pipeline outages do not count. The count is the hidden log, not the number of reports. A quiet inbox can hide a cluster, and a loud inbox can hide a running total. Sealed until the debrief.",
      threshold: CONFIG.incidentQuestionCount,
      windowStart: start,
      windowEnd: end,
      sealed: true,
    };
  }
  const claim = pickStateClaim(world, morningDay);
  if (claim) {
    const excerpt = claim.text.length > 140 ? `${claim.text.slice(0, 137)}…` : claim.text;
    return {
      id: `q-claim-${morningDay}-${claim.id}`,
      askedDay: morningDay,
      kind: "claim",
      text: `State-affiliated report ${claim.id} describes at least one real incident.`,
      detail: `“${excerpt}” An inflated count can still be substantively true. An invented report is not. Scored against the hidden log at the debrief, not against whether the joint centre has caught up.`,
      reportId: claim.id,
      sealed: true,
    };
  }
  const start = morningDay;
  const end = Math.min(CONFIG.days, morningDay + 6);
  return {
    id: `q-mine-${morningDay}`,
    askedDay: morningDay,
    kind: "mine",
    text: `At least one true mine contact will occur in the Strait on days ${start} through ${end}.`,
    detail:
      "There is no fresh state-affiliated claim to score, so the question is the mine log in the Strait. Sealed until the debrief. Reports of mines can be late, mislocated, or absent.",
    windowStart: start,
    windowEnd: end,
    threshold: 1,
    sealed: true,
  };
}

/** Null when the release or the window is not in the world yet. */
export function tryResolve(question: ForecastQuestion, world: World): 0 | 1 | null {
  if (question.kind === "flow") {
    const release = world.releases.find((item) => item.filedDay === question.releaseFiledDay);
    if (!release) return null;
    return release.printedMbPerDay + 1e-9 >= (question.threshold ?? CONFIG.flowQuestionMb) ? 1 : 0;
  }
  const lastDay = world.days.length > 0 ? world.days[world.days.length - 1].day : 0;
  if (question.kind === "claim") {
    if (lastDay < CONFIG.days && lastDay < question.askedDay) return null;
    const report = world.reports.find((item) => item.id === question.reportId);
    if (!report) return 0;
    return !report.truth.fabricated && report.truth.realEventIds.length > 0 ? 1 : 0;
  }
  if (question.windowEnd == null || lastDay < question.windowEnd) return null;
  if (question.kind === "incidents") {
    const count = world.events.filter(
      (event) =>
        event.day >= (question.windowStart ?? 1) &&
        event.day <= (question.windowEnd ?? 1) &&
        (event.zone === "gulf" || event.zone === "strait") &&
        threatKinds().has(event.kind),
    ).length;
    return count >= (question.threshold ?? CONFIG.incidentQuestionCount) ? 1 : 0;
  }
  const mines = world.events.filter(
    (event) =>
      event.kind === "mine" &&
      event.zone === "strait" &&
      event.day >= (question.windowStart ?? 1) &&
      event.day <= (question.windowEnd ?? 1),
  ).length;
  return mines >= 1 ? 1 : 0;
}

export function claimExcerpt(report: Report): string {
  return `${report.id}, ${zoneName(report.zone)}, alleged ${allegedLabel(report.allegedDay)}`;
}

function pickStateClaim(world: World, morningDay: number): Report | null {
  const candidates = world.reports.filter(
    (report) =>
      report.source === "state" &&
      !report.truth.runningTotal &&
      report.filedDay <= morningDay &&
      report.filedDay >= morningDay - 6,
  );
  candidates.sort((a, b) => b.claimedCount - a.claimedCount || b.filedDay - a.filedDay || (a.id < b.id ? -1 : 1));
  return candidates[0] ?? null;
}
