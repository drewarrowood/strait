import { CONFIG } from "./config";
import { playerCable, visibleEvidence } from "./damage";
import type { HistoryDay, Morning, PublicDamageCase, PublicProgrammeEvent, PublicRelease, PublicReport, World } from "./types";

/** What the desk is allowed to know on a morning. Hidden posture, mines, and report truth stay out. */
export function presentMorning(world: World, morningDay: number): Morning {
  const played = world.days.filter((day) => day.day < morningDay);
  const yesterday = played.length > 0 ? toHistory(played[played.length - 1]) : null;
  const headline = yesterday ?? {
    backlogShips: world.opening.backlogShips,
    priceIndex: world.opening.priceIndex,
    pressure: world.opening.pressure,
  };
  const reports = world.reports
    .filter((report) => report.filedDay <= morningDay && report.filedDay >= 1)
    .map(toPublicReport)
    .sort((a, b) => a.filedDay - b.filedDay || a.id.localeCompare(b.id));
  const releases = world.releases
    .filter((release) => release.filedDay <= morningDay)
    .map(toPublicRelease);
  return {
    day: morningDay,
    finalMorning: morningDay > CONFIG.days,
    backlogShips: headline.backlogShips,
    priceIndex: headline.priceIndex,
    pressure: headline.pressure,
    releases,
    newRelease: releases.find((release) => release.filedDay === morningDay) ?? null,
    reports,
    newReports: reports.filter((report) => report.filedDay === morningDay),
    programmeEvents: world.events
      .filter((event) => event.programme && event.day < morningDay && event.kind !== "pipeline")
      .map((event) => toProgramme(event, morningDay)),
    damageCases: damageCases(world, morningDay),
    history: played.map(toHistory),
    yesterday,
  };
}

function toPublicReport(report: World["reports"][number]): PublicReport {
  return {
    id: report.id,
    filedDay: report.filedDay,
    allegedDay: report.allegedDay,
    source: report.source,
    zone: report.zone,
    kind: report.kind,
    claimedCount: report.claimedCount,
    text: report.text,
    damageReport: report.damageReport,
  };
}

function toPublicRelease(release: World["releases"][number]): PublicRelease {
  return {
    id: release.id,
    filedDay: release.filedDay,
    fromDay: release.fromDay,
    toDay: release.toDay,
    printedMbPerDay: release.printedMbPerDay,
  };
}

function toProgramme(event: World["events"][number], morningDay: number): PublicProgrammeEvent {
  const evidence = event.damage ? visibleEvidence(event.damage, event.day, morningDay) : null;
  const summary = event.damage && evidence
    ? playerCable(event.damage, evidence, { casualties: event.casualties, missing: event.missing })
    : event.summary;
  return {
    id: event.id,
    day: event.day,
    zone: event.zone,
    kind: event.kind,
    shipsDamaged: event.shipsDamaged,
    casualties: event.casualties,
    missing: event.missing,
    escorted: event.escorted,
    convoySize: event.convoySize,
    summary,
    damageReport: evidence != null,
    condition: evidence ? event.damage?.condition : undefined,
  };
}

function damageCases(world: World, morningDay: number): PublicDamageCase[] {
  const revealed = new Set<string>();
  for (const report of world.reports) {
    if (report.filedDay > morningDay || report.filedDay < 1 || report.truth.fabricated) continue;
    for (const id of report.truth.realEventIds) revealed.add(id);
  }
  const cases: PublicDamageCase[] = [];
  for (const event of world.events) {
    if (!event.damage) continue;
    if (!event.programme && !revealed.has(event.id)) continue;
    const evidence = visibleEvidence(event.damage, event.day, morningDay);
    if (!evidence) continue;
    cases.push({
      eventId: event.id,
      day: event.day,
      zone: event.zone,
      programme: event.programme,
      text: playerCable(
        event.damage,
        evidence,
        event.programme ? { casualties: event.casualties, missing: event.missing } : null,
      ),
      stage: evidence.stage,
      condition: event.damage.condition,
      casualtyRisk: event.damage.casualtyRisk,
      shipsDamaged: event.shipsDamaged,
      casualties: event.programme ? event.casualties : 0,
      missing: event.programme ? event.missing : 0,
    });
  }
  cases.sort((a, b) => a.day - b.day || (a.eventId < b.eventId ? -1 : 1));
  return cases;
}

function toHistory(day: World["days"][number]): HistoryDay {
  return {
    day: day.day,
    programmeStraitFlowMb: day.programmeStraitFlowMb,
    backlogShips: day.backlogShips,
    priceIndex: day.priceIndex,
    pressure: day.pressure,
    programmeDamaged: day.programmeDamaged,
    programmeCasualties: day.programmeCasualties,
    programmeMissing: day.programmeMissing,
    operatorNotes: day.operatorNotes,
    programmeAttempted: day.programmeAttempted,
    programmeArrived: day.programmeArrived,
    programmeReturned: day.programmeReturned,
    fujFlowMb: day.fujFlowMb,
    yanbuFlowMb: day.yanbuFlowMb,
  };
}
