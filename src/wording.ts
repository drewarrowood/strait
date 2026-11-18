import { dayLabel, zoneName } from "./labels";
import type { IncidentKind, Source, Zone } from "./types";

export interface WordingInput {
  source: Source;
  kind: IncidentKind;
  zone: Zone | "unspecified";
  claimed: number;
  allegedDay: number;
  late: boolean;
  runningTotal: boolean;
  casualties: number;
  variant: number;
  /** Weekly sum, used only for running-total copy. */
  windowDays?: number;
}

function ships(n: number): string {
  return n === 1 ? "one ship" : `${n} ships`;
}

export function reportText(input: WordingInput): string {
  const where = zoneName(input.zone);
  const when = dayLabel(input.allegedDay);
  const v = Math.abs(input.variant) % 3;

  if (input.runningTotal) {
    const lines = [
      `A wire story, citing unnamed maritime sources, says incidents around the Strait have reached ${input.claimed} over recent days. The copy does not say how many of those were new on ${when}.`,
      `Press desk: "the number of incidents this period now stands at ${input.claimed}." The sentence is a running figure. It is not a count for a single day.`,
      `A market note adds earlier cases to the latest rumor and writes that incidents "have reached ${input.claimed}." Nothing in the note separates today from the days before it.`,
    ];
    return lines[v];
  }

  if (input.source === "ukmto") {
    const late = input.late ? ` Filed today, concerning ${when}.` : "";
    const lines = [
      `Trade-operations alert, unconfirmed. ${cap(input.kind)} reported in the ${where}, involving ${ships(input.claimed)}. Masters have not all been reached.${late}`,
      `Unconfirmed trade alert from the ${where}: a report of ${kindPhrase(input.kind)} affecting ${ships(input.claimed)}. The alert is not a confirmation.${late}`,
      `Trade desk passes an unconfirmed report of ${kindPhrase(input.kind)} in the ${where}. Claimed figure: ${input.claimed}. Treat the place and the count as unchecked.${late}`,
    ];
    return lines[v];
  }

  if (input.source === "liaison") {
    const crew =
      input.casualties > 0
        ? ` Crew casualties reported to the cell: ${input.casualties}.`
        : " No crew casualties in this note.";
    const lines = [
      `Liaison note for the cell. ${cap(kindPhrase(input.kind))} in the ${where}, ${when}. Ships in the note: ${input.claimed}.${crew} This is a direct note, not a public claim.`,
      `Partner desk writes that it has a ${kindPhrase(input.kind)} in the ${where} on ${when}. Figure in the note: ${input.claimed}.${crew}`,
      `Liaison, terse: ${kindPhrase(input.kind)}, ${where}, ${when}. Count they will stand behind: ${input.claimed}.${crew}`,
    ];
    return lines[v];
  }

  if (input.source === "state") {
    const lines = [
      `State-affiliated outlet claims ${ships(input.claimed)} were hit in the ${where} and that the lane is no longer safe. The dispatch includes no evidence a desk can check.`,
      `A state-affiliated channel says ${input.claimed} merchant ships suffered ${kindPhrase(input.kind)} in the ${where} on ${when}. The wording is definite. The sourcing is not.`,
      `State-affiliated media: "${input.claimed} tankers attacked in the ${where}." The claim is larger than a single alert and is not matched, in the copy, to named ships.`,
    ];
    return lines[v];
  }

  if (input.source === "press") {
    const lines = [
      `Press relay of an earlier alert: ${kindPhrase(input.kind)} in the ${where}, figure ${input.claimed}. The copy adds no new ship, time, or place. It reads as a restatement.`,
      `A wire repeats a report already in circulation about the ${where} (${kindPhrase(input.kind)}, claimed ${input.claimed}). Nothing in the paragraph is sourced to a fresh observation.`,
      `News brief, citing "maritime sources," retells a ${kindPhrase(input.kind)} report from the ${where}. Claimed figure ${input.claimed}. This is a second telling, not a second event.`,
    ];
    return lines[v];
  }

  if (input.source === "jmic") {
    const lines = [
      `Joint centre bulletin. Confirmed ${kindPhrase(input.kind)} in the ${where} on ${when}. Incidents accepted in this item: ${input.claimed}. Events from the last day of the window are still in processing and are not in this bulletin.`,
      `Joint centre, confirmed. ${cap(kindPhrase(input.kind))}, ${where}, ${when}. Count in the bulletin: ${input.claimed}.`,
      `Official joint bulletin accepts one item: ${kindPhrase(input.kind)} in the ${where} on ${when}. Figure: ${input.claimed}. Later filings can still revise a quiet week.`,
    ];
    return lines[v];
  }

  const lines = [
    `A reporter quotes an anonymous official who says there was "an incident" near the ${where}. No named ship, no time more precise than ${when}, claimed figure ${input.claimed}.`,
    `Anonymous official, via a reporter: something happened in connection with the ${where}. The official would not give a count the reporter could stand up. The story still prints ${input.claimed}.`,
    `An unnamed official tells the press of ${kindPhrase(input.kind)} "in the region of the ${where}." The quote is thin. Claimed figure: ${input.claimed}.`,
  ];
  return lines[v];
}

export function releaseText(fromDay: number, toDay: number, printed: string): string {
  return `Official release. Average oil flow through the Strait for days ${fromDay}–${toDay}: ${printed} mb/d. This is a rounded statistical figure for the whole theatre, with measurement error. It is not your programme total, and it is not a daily count.`;
}

function cap(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function kindPhrase(kind: IncidentKind): string {
  switch (kind) {
    case "mine":
      return "a mine contact";
    case "harassment":
      return "harassment of a merchant ship";
    case "security":
      return "a security incident against a merchant ship";
    case "gnss":
      return "GNSS interference";
    case "congestion":
      return "a congestion mishap";
    case "pipeline":
      return "a pipeline station outage";
  }
}
