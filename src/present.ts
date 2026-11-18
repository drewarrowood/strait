import { CONFIG } from "./config";
import type { HistoryDay, Morning, PublicProgrammeEvent, PublicRelease, PublicReport, World } from "./types";

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
      .map(toProgramme),
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

function toProgramme(event: World["events"][number]): PublicProgrammeEvent {
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
    summary: event.summary,
  };
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
