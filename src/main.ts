import { CONFIG } from "./config";
import { sanitizeWeaponTags } from "./damage";
import { BASELINE, cloneDecision, describePlan, reserveEscorts, reserveMcm, sanitizeDecision } from "./decide";
import { presentMorning } from "./present";
import { questionForMorning } from "./questions";
import { simulate } from "./model";
import { buildScorecard } from "./score";
import { clamp, clampInt } from "./rng";
import type {
  CallConfidence,
  ConvoySize,
  Decisions,
  Disposition,
  Guidance,
  PublicMessage,
  Source,
  WeaponCall,
  Zone,
} from "./types";
import { planReadout, render, type AppState, type Phase } from "./ui";
import "./style.css";

const SAVE_KEY = "strait.v1";

const app: AppState = {
  screen: "start",
  tutorialStep: 0,
  seedInput: seedFromHash(),
  seed: "",
  decisions: [],
  draft: cloneDecision(BASELINE),
  ledger: {},
  weaponTags: {},
  answers: [],
  forecastDraft: 50,
  forecastTouched: false,
  phase: "brief",
  lookingAt: null,
  zone: null,
  ledgerMode: "open",
  source: "all",
  rulesOpen: false,
  abandonArmed: false,
  scorecard: null,
  scoring: false,
  hasSave: load() != null,
  copied: false,
};

const root = document.querySelector("#app");
if (!root) throw new Error("Missing #app");
const appRoot = root;

appRoot.addEventListener("click", onClick);
appRoot.addEventListener("input", onInput);
appRoot.addEventListener("change", onChange);
appRoot.addEventListener("keydown", onKey);
draw();

function draw(): void {
  appRoot.innerHTML = render(app);
}

function onClick(event: Event): void {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return;
  const zoneOnly = target.closest("[data-zone]");
  const actionEl = target.closest<HTMLElement>("[data-action]");
  if (!actionEl && zoneOnly instanceof HTMLElement && zoneOnly.dataset.zone) {
    app.zone = zoneOnly.dataset.zone as Zone;
    app.abandonArmed = false;
    draw();
    return;
  }
  if (!actionEl) return;
  const action = actionEl.dataset.action;
  if (action !== "abandon") app.abandonArmed = false;
  if (action === "begin") begin();
  else if (action === "resume") resume();
  else if (action === "tutorial-next") tutorialNext();
  else if (action === "tutorial-back") {
    app.tutorialStep = Math.max(0, app.tutorialStep - 1);
    draw();
  } else if (action === "tutorial-skip") {
    app.screen = "play";
    save();
    draw();
  } else if (action === "phase") {
    const phase = actionEl.dataset.phase as Phase;
    if (phase) app.phase = phase;
    draw();
  } else if (action === "step") nudge(actionEl.dataset.field ?? "", Number(actionEl.dataset.dir));
  else if (action === "convoy") setConvoy(Number(actionEl.dataset.size));
  else if (action === "guidance") setDraft("guidance", actionEl.dataset.value as Guidance);
  else if (action === "message") setDraft("message", actionEl.dataset.value as PublicMessage);
  else if (action === "commit") commit();
  else if (action === "debrief") openDebrief();
  else if (action === "ledger-set") setDisposition(actionEl.dataset.report ?? "", actionEl.dataset.disposition as Disposition);
  else if (action === "weapon-call") setWeaponCall(actionEl.dataset.event ?? "", actionEl.dataset.call as WeaponCall);
  else if (action === "weapon-confidence") setWeaponConfidence(actionEl.dataset.event ?? "", actionEl.dataset.confidence as CallConfidence);
  else if (action === "filter") {
    const mode = actionEl.dataset.mode;
    if (mode === "open" || mode === "new" || mode === "all") app.ledgerMode = mode;
    draw();
  } else if (action === "zone") {
    app.zone = (actionEl.dataset.zone as Zone) || null;
    draw();
  } else if (action === "look") look(Number(actionEl.dataset.day));
  else if (action === "today") {
    app.lookingAt = null;
    app.phase = "brief";
    draw();
  } else if (action === "forecast-record") {
    app.forecastTouched = true;
    save();
    draw();
  } else if (action === "copy-seed") void copySeed();
  else if (action === "rules") {
    app.rulesOpen = true;
    draw();
  } else if (action === "rules-close") {
    app.rulesOpen = false;
    draw();
  } else if (action === "abandon") abandon();
  else if (action === "new-month") {
    clearSave();
    app.screen = "start";
    app.seedInput = "";
    app.hasSave = false;
    draw();
  }
}

function onInput(event: Event): void {
  const target = event.target;
  if (!(target instanceof HTMLInputElement)) return;
  if (target.id === "seed") {
    app.seedInput = target.value;
    return;
  }
  if (target.dataset.forecast) {
    app.forecastDraft = clampInt(Number(target.value), 0, 100);
    app.forecastTouched = true;
    const label = document.getElementById("forecast-readout");
    if (label) label.textContent = `${app.forecastDraft}%`;
    document.getElementById("commit")?.removeAttribute("disabled");
    const record = document.querySelector<HTMLButtonElement>("[data-action='forecast-record']");
    if (record) record.textContent = `Record ${app.forecastDraft}%`;
    return;
  }
  if (target.dataset.count) {
    const id = target.dataset.count;
    const prev = app.ledger[id];
    app.ledger[id] = {
      reportId: id,
      disposition: "confirm",
      reviewed: true,
      confirmCount: clampInt(Number(target.value), 0, 12),
      mergeTargetId: prev?.mergeTargetId,
    };
    save();
    return;
  }
  if (target.dataset.field) {
    applySlider(target.dataset.field, Number(target.value));
    const label = document.getElementById(`val-${target.dataset.field}`);
    if (label) label.textContent = sliderText(target.dataset.field, Number(target.value));
    const summary = document.getElementById("plan-summary");
    if (summary) summary.textContent = describePlan(sanitizeDecision(app.draft));
    scheduleBands();
  }
}

function onChange(event: Event): void {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.dataset.merge) {
    const id = target.dataset.merge;
    const prev = app.ledger[id];
    app.ledger[id] = {
      reportId: id,
      disposition: "merge",
      reviewed: true,
      confirmCount: prev?.confirmCount,
      mergeTargetId: target.value || undefined,
    };
    save();
    return;
  }
  if (target instanceof HTMLSelectElement && target.dataset.action === "source") {
    app.source = target.value as Source | "all";
    draw();
  }
}

function onKey(event: Event): void {
  if (!(event instanceof KeyboardEvent) || event.key !== "Enter") return;
  if (event.target instanceof HTMLInputElement && event.target.id === "seed") begin();
}

function begin(): void {
  const seed = app.seedInput.trim() || makeSeed();
  startCampaign(seed, true);
}

function startCampaign(seed: string, tutorial: boolean): void {
  app.seed = seed;
  app.seedInput = seed;
  app.decisions = [];
  app.draft = cloneDecision(BASELINE);
  app.ledger = {};
  app.weaponTags = {};
  app.answers = [];
  app.forecastDraft = 50;
  app.forecastTouched = false;
  app.phase = "brief";
  app.lookingAt = null;
  app.zone = null;
  app.scorecard = null;
  app.scoring = false;
  app.tutorialStep = 0;
  app.screen = tutorial ? "tutorial" : "play";
  app.copied = false;
  location.hash = `seed=${encodeURIComponent(seed)}`;
  save();
  draw();
}

function tutorialNext(): void {
  if (app.tutorialStep >= 3) {
    app.screen = "play";
    save();
  } else app.tutorialStep += 1;
  draw();
}

function resume(): void {
  const saved = load();
  if (!saved) return;
  app.seed = saved.seed;
  app.seedInput = saved.seed;
  app.decisions = saved.decisions.map((decision) => sanitizeDecision(decision));
  app.draft = sanitizeDecision(saved.draft ?? app.decisions[app.decisions.length - 1] ?? BASELINE);
  app.ledger = saved.ledger ?? {};
  app.weaponTags = sanitizeWeaponTags(saved.weaponTags);
  app.answers = Array.isArray(saved.answers) ? saved.answers : [];
  app.phase = saved.phase ?? "brief";
  app.forecastDraft = saved.forecastDraft ?? 50;
  app.forecastTouched = Boolean(saved.forecastTouched);
  app.lookingAt = null;
  app.scorecard = null;
  location.hash = `seed=${encodeURIComponent(saved.seed)}`;
  if (saved.screen === "debrief" && app.decisions.length >= CONFIG.days) openDebrief();
  else {
    app.screen = saved.screen === "tutorial" ? "tutorial" : "play";
    app.tutorialStep = saved.tutorialStep ?? 0;
    draw();
  }
}

function commit(): void {
  if (app.lookingAt != null) return;
  const liveDay = app.decisions.length + 1;
  if (liveDay > CONFIG.days) return;
  const world = simulate(app.seed, app.decisions);
  const question = questionForMorning(world, liveDay);
  if (question && !app.forecastTouched) return;
  if (question && !app.answers.some((answer) => answer.question.id === question.id)) {
    app.answers.push({ question, probability: clamp(app.forecastDraft / 100, 0, 1) });
  }
  app.decisions.push(cloneDecision(sanitizeDecision(app.draft)));
  app.draft = cloneDecision(app.decisions[app.decisions.length - 1]);
  app.forecastTouched = false;
  app.forecastDraft = 50;
  app.phase = "brief";
  app.lookingAt = null;
  app.ledgerMode = "open";
  if (app.decisions.length >= CONFIG.days && app.phase === "brief") {
    /* final morning still uses the brief */
  }
  save();
  draw();
  window.scrollTo(0, 0);
}

function openDebrief(): void {
  if (app.scoring || app.decisions.length < CONFIG.days) return;
  app.screen = "debrief";
  app.scoring = true;
  app.scorecard = null;
  save();
  draw();
  window.setTimeout(() => {
    const world = simulate(app.seed, app.decisions);
    app.scorecard = buildScorecard(world, app.decisions, app.ledger, app.answers, CONFIG.replaySamples, app.weaponTags);
    app.scoring = false;
    save();
    draw();
  }, 30);
}

function setWeaponCall(eventId: string, call: WeaponCall): void {
  if (!eventId) return;
  if (call !== "mine" && call !== "drone" && call !== "missile" && call !== "unknown") return;
  const prev = app.weaponTags[eventId];
  app.weaponTags[eventId] = {
    eventId,
    call,
    confidence: call === "unknown" ? "medium" : (prev?.confidence ?? "medium"),
  };
  save();
  draw();
}

function setWeaponConfidence(eventId: string, confidence: CallConfidence): void {
  if (!eventId) return;
  if (confidence !== "low" && confidence !== "medium" && confidence !== "high") return;
  const prev = app.weaponTags[eventId];
  if (!prev || prev.call === "unknown") return;
  app.weaponTags[eventId] = { eventId, call: prev.call, confidence };
  save();
  draw();
}

function setDisposition(id: string, disposition: Disposition): void {
  if (!id || !disposition) return;
  const world = simulate(app.seed, app.decisions);
  const morning = presentMorning(world, app.decisions.length + 1);
  const report = morning.reports.find((item) => item.id === id);
  const prev = app.ledger[id];
  app.ledger[id] = {
    reportId: id,
    disposition,
    reviewed: true,
    confirmCount: disposition === "confirm" ? (prev?.confirmCount ?? report?.claimedCount ?? 1) : prev?.confirmCount,
    mergeTargetId: disposition === "merge" ? prev?.mergeTargetId : undefined,
  };
  save();
  draw();
}

function nudge(field: string, dir: number): void {
  if (!Number.isFinite(dir)) return;
  if (dir > 0 && field.startsWith("escort") && reserveEscorts(app.draft) <= 0) return;
  if (dir > 0 && field.startsWith("mcm") && reserveMcm(app.draft) <= 0) return;
  const current = app.draft[field as keyof Decisions];
  if (typeof current !== "number") return;
  const next: Decisions = { ...app.draft, [field]: current + dir };
  if (field === "straitAttemptShips") next.straitAttemptShips = clampInt(next.straitAttemptShips, 0, CONFIG.maxProgrammeShips);
  const clean = sanitizeDecision(next);
  if (dir > 0 && clean[field as keyof Decisions] === current) return;
  app.draft = clean;
  save();
  draw();
}

function setConvoy(size: number): void {
  if (size !== 2 && size !== 4 && size !== 8 && size !== 12) return;
  app.draft = { ...app.draft, convoySize: size as ConvoySize };
  save();
  draw();
}

function setDraft(key: "guidance" | "message", value: Guidance | PublicMessage | undefined): void {
  if (!value) return;
  app.draft = sanitizeDecision({ ...app.draft, [key]: value });
  save();
  draw();
}

function applySlider(field: string, raw: number): void {
  if (field === "yanbuSouthShare") app.draft = { ...app.draft, yanbuSouthShare: raw / 100 };
  else if (field === "fujairahMb") app.draft = { ...app.draft, fujairahMb: raw };
  else if (field === "yanbuMb") app.draft = { ...app.draft, yanbuMb: raw };
  app.draft = sanitizeDecision(app.draft);
}

function sliderText(field: string, raw: number): string {
  if (field === "yanbuSouthShare") return `${Math.round(raw)}%`;
  return raw.toFixed(1);
}

let bandTimer = 0;
function scheduleBands(): void {
  window.clearTimeout(bandTimer);
  bandTimer = window.setTimeout(() => {
    const slot = document.getElementById("plan-readout");
    if (!slot) return;
    const morning = presentMorning(simulate(app.seed, app.decisions), app.decisions.length + 1);
    slot.innerHTML = `<h2>What the model will say</h2>${planReadout(app.draft, morning)}`;
    save();
  }, 140);
}

function look(day: number): void {
  const live = app.decisions.length + 1;
  if (day === live) app.lookingAt = null;
  else if (day >= 1 && day <= app.decisions.length) app.lookingAt = day;
  app.phase = "brief";
  draw();
}

function abandon(): void {
  if (!app.abandonArmed) {
    app.abandonArmed = true;
    draw();
    return;
  }
  clearSave();
  app.screen = "start";
  app.hasSave = false;
  app.abandonArmed = false;
  draw();
}

async function copySeed(): Promise<void> {
  const seed = app.seed || app.seedInput.trim();
  if (!seed) return;
  const url = `${location.origin}${location.pathname}#seed=${encodeURIComponent(seed)}`;
  try {
    await navigator.clipboard.writeText(url);
  } catch {
    const input = document.createElement("input");
    input.value = url;
    document.body.appendChild(input);
    input.select();
    document.execCommand("copy");
    input.remove();
  }
  app.copied = true;
  draw();
}

function makeSeed(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = new Uint32Array(6);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => alphabet[value % alphabet.length]).join("");
}

function seedFromHash(): string {
  const match = /seed=([^&]+)/.exec(location.hash);
  return match ? decodeURIComponent(match[1]) : "";
}

interface SaveFile {
  v: 1;
  seed: string;
  decisions: Decisions[];
  draft: Decisions;
  ledger: AppState["ledger"];
  weaponTags?: AppState["weaponTags"];
  answers: AppState["answers"];
  phase: Phase;
  forecastDraft: number;
  forecastTouched: boolean;
  screen: AppState["screen"];
  tutorialStep: number;
}

function save(): void {
  if (app.screen === "start" || !app.seed) return;
  const payload: SaveFile = {
    v: 1,
    seed: app.seed,
    decisions: app.decisions,
    draft: app.draft,
    ledger: app.ledger,
    weaponTags: app.weaponTags,
    answers: app.answers,
    phase: app.phase,
    forecastDraft: app.forecastDraft,
    forecastTouched: app.forecastTouched,
    screen: app.screen,
    tutorialStep: app.tutorialStep,
  };
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(payload));
    app.hasSave = true;
  } catch {
    /* private mode */
  }
}

function load(): SaveFile | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SaveFile;
    if (parsed.v !== 1 || typeof parsed.seed !== "string" || !Array.isArray(parsed.decisions)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSave(): void {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* ignore */
  }
}
