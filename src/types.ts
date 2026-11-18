export type Zone = "gulf" | "strait" | "oman" | "yanbu" | "bab";

export type Source = "jmic" | "ukmto" | "state" | "press" | "anon" | "liaison";

export type IncidentKind = "mine" | "harassment" | "security" | "gnss" | "congestion" | "pipeline";

export type Guidance = "sail" | "caution" | "defer";

export type PublicMessage = "reassure" | "factual" | "warn" | "silent";

export type ConvoySize = 2 | 4 | 8 | 12;

export type Disposition = "hold" | "exclude" | "confirm" | "merge";

export interface Decisions {
  escortStrait: number;
  escortOman: number;
  escortBab: number;
  convoySize: ConvoySize;
  mcmStrait: number;
  mcmOman: number;
  mcmBab: number;
  /** Programme tankers called toward the Strait today. */
  straitAttemptShips: number;
  fujairahMb: number;
  yanbuMb: number;
  /** Share of Yanbu loadings that sail south and must pass Bab al-Mandab. The rest go north via Suez and do not. */
  yanbuSouthShare: number;
  guidance: Guidance;
  message: PublicMessage;
}

export interface TrueEvent {
  id: string;
  /** Player days are 1–30. Zero and negative days are the watch before you arrived. */
  day: number;
  zone: Zone;
  kind: IncidentKind;
  /** True when the event struck ships in the programme you schedule. */
  programme: boolean;
  shipsAffected: number;
  shipsDamaged: number;
  casualties: number;
  /** Missing crew are included in `casualties`, not added on top. */
  missing: number;
  flowLostMb: number;
  escorted: boolean;
  convoySize: number;
  summary: string;
}

export interface ReportTruth {
  realEventIds: string[];
  fabricated: boolean;
  duplicateOfReportId?: string;
  /** Cumulative figure written so a skimmer can mistake it for a daily count. */
  runningTotal: boolean;
  mislocated: boolean;
  inflated: boolean;
  lateFiled: boolean;
  restatement: boolean;
  /** Distinct true events this report refers to. Zero if fabricated. For a running total this is the multi-day sum, not a daily count. */
  trueCount: number;
  trueZone?: Zone;
}

export interface Report {
  id: string;
  filedDay: number;
  allegedDay: number;
  source: Source;
  zone: Zone | "unspecified";
  kind: IncidentKind;
  claimedCount: number;
  text: string;
  truth: ReportTruth;
}

export interface FlowRelease {
  id: string;
  filedDay: number;
  fromDay: number;
  toDay: number;
  /** Official printed average Strait flow, mb/d, one decimal, with measurement error. */
  printedMbPerDay: number;
  /** Hidden true mean. Not for the play screen. */
  trueMeanMbPerDay: number;
  confirmedIncidentIds: string[];
}

export interface DayRecord {
  day: number;
  posture: number;
  mineStrait: number;
  mineOman: number;
  mineBab: number;
  excitation: number;
  nominationMb: number;
  straitFlowMb: number;
  programmeStraitFlowMb: number;
  backgroundStraitFlowMb: number;
  fujFlowMb: number;
  yanbuFlowMb: number;
  systemFlowMb: number;
  backlogShips: number;
  priceIndex: number;
  pressure: number;
  programmeAttempted: number;
  programmeEscorted: number;
  programmeArrived: number;
  programmeReturned: number;
  programmeDamaged: number;
  programmeCasualties: number;
  programmeMissing: number;
  backgroundShips: number;
  backgroundDamaged: number;
  backgroundCasualties: number;
  fujNominatedMb: number;
  yanbuNominatedMb: number;
  yanbuSouthShips: number;
  operatorNotes: string[];
  damageToday: number;
  casualtiesToday: number;
  missingToday: number;
  /** Mine, harassment, and security events in the Gulf and the Strait today. */
  gulfStraitThreats: number;
}

export interface Opening {
  backlogShips: number;
  priceIndex: number;
  pressure: number;
}

export interface World {
  seed: string;
  events: TrueEvent[];
  reports: Report[];
  releases: FlowRelease[];
  /** Player days only, in order. The pre-desk watch is not in this list. */
  days: DayRecord[];
  opening: Opening;
}

export interface LedgerMark {
  reportId: string;
  disposition: Disposition;
  confirmCount?: number;
  mergeTargetId?: string;
  reviewed: boolean;
}

export type QuestionKind = "flow" | "incidents" | "claim" | "mine";

export interface ForecastQuestion {
  id: string;
  askedDay: number;
  kind: QuestionKind;
  text: string;
  detail: string;
  threshold?: number;
  windowStart?: number;
  windowEnd?: number;
  releaseFiledDay?: number;
  reportId?: string;
  /** Sealed questions are scored at the debrief. The truth is not in the inbox. */
  sealed: boolean;
  revealDay?: number;
}

export interface ForecastAnswer {
  question: ForecastQuestion;
  /** 0–1. */
  probability: number;
  outcome?: 0 | 1;
}

export interface PublicReport {
  id: string;
  filedDay: number;
  allegedDay: number;
  source: Source;
  zone: Zone | "unspecified";
  kind: IncidentKind;
  claimedCount: number;
  text: string;
}

export interface PublicProgrammeEvent {
  id: string;
  day: number;
  zone: Zone;
  kind: IncidentKind;
  shipsDamaged: number;
  casualties: number;
  missing: number;
  escorted: boolean;
  convoySize: number;
  summary: string;
}

export interface PublicRelease {
  id: string;
  filedDay: number;
  fromDay: number;
  toDay: number;
  printedMbPerDay: number;
}

export interface HistoryDay {
  day: number;
  programmeStraitFlowMb: number;
  backlogShips: number;
  priceIndex: number;
  pressure: number;
  programmeDamaged: number;
  programmeCasualties: number;
  programmeMissing: number;
  operatorNotes: string[];
  programmeAttempted: number;
  programmeArrived: number;
  programmeReturned: number;
  fujFlowMb: number;
  yanbuFlowMb: number;
}

export interface Morning {
  day: number;
  /** Last player morning is 31: the books after day 30, with no further plan. */
  finalMorning: boolean;
  backlogShips: number;
  priceIndex: number;
  pressure: number;
  releases: PublicRelease[];
  newRelease: PublicRelease | null;
  reports: PublicReport[];
  newReports: PublicReport[];
  programmeEvents: PublicProgrammeEvent[];
  history: HistoryDay[];
  yesterday: HistoryDay | null;
}
