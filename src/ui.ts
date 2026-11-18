import { calibrationChart, histogram, postureChart, sparkline } from "./charts";
import { CONFIG } from "./config";
import { callLabel, conditionShort, playerCable, weaponLabel } from "./damage";
import { BASELINE, describePlan, reserveEscorts, reserveMcm, sanitizeDecision } from "./decide";
import { bandText, escapeHtml, judgmentWord, oneDecimal, percent, pressureWord, whole } from "./format";
import { KIND_LABEL, SOURCE_HINT, SOURCE_LABEL, ZONE_LABEL, allegedLabel, zoneName } from "./labels";
import { ZONE_BLURB, mapSvg } from "./map";
import { simulate } from "./model";
import { presentMorning } from "./present";
import { projectPlan, type Projection } from "./project";
import { questionForMorning, tryResolve } from "./questions";
import { quantile } from "./rng";
import { judgmentWeights, type Scorecard } from "./score";
import type {
  CallConfidence,
  Decisions,
  ForecastAnswer,
  Guidance,
  LedgerMark,
  Morning,
  PublicDamageCase,
  PublicMessage,
  PublicProgrammeEvent,
  PublicReport,
  Source,
  WeaponCall,
  WeaponTag,
  Zone,
} from "./types";

export type Phase = "brief" | "ledger" | "plan" | "forecast";
export type Screen = "start" | "tutorial" | "play" | "debrief";

export interface AppState {
  screen: Screen;
  tutorialStep: number;
  seedInput: string;
  seed: string;
  decisions: Decisions[];
  draft: Decisions;
  ledger: Record<string, LedgerMark>;
  weaponTags: Record<string, WeaponTag>;
  answers: ForecastAnswer[];
  forecastDraft: number;
  forecastTouched: boolean;
  phase: Phase;
  lookingAt: number | null;
  zone: Zone | null;
  ledgerMode: "open" | "new" | "all";
  source: Source | "all";
  rulesOpen: boolean;
  abandonArmed: boolean;
  scorecard: Scorecard | null;
  scoring: boolean;
  hasSave: boolean;
  copied: boolean;
}

const TUTORIAL = [
  {
    title: "You coordinate. You do not strike.",
    body: "You are the shipping coordinator for a fictional month. Each turn is one day. You decide which tankers sail, where six escorts and three sweepers go, how much oil tries the bypass pipelines, what you tell owners, and what you say in public. You never choose a weapon, a target, or a strike. Harm in this exercise is something that happens to ships, and your job is to make it less likely without pretending the oil can stop.",
  },
  {
    title: "Five waters, two bypasses.",
    body: "The Strait of Hormuz is the tanker route. The Fujairah pipeline crosses to the Gulf of Oman and loads there; it has a capacity and it can suffer a station outage. The East–West line goes to Yanbu on the Red Sea. Cargo that then sails south must pass Bab al-Mandab. Cargo that goes north toward Suez does not. Escorts cover your ships first. Spare slots cover other traffic in that lane. Sweepers slowly cut mine hazard for everyone in the lane.",
  },
  {
    title: "The inbox is not the sea.",
    body: "You will get trade alerts that are fast and unconfirmed, liaison notes that are usually straight, a joint-centre bulletin that closes before it is published, state-affiliated claims that run high or invent a story, anonymous quotes, and press copy that repeats someone else. Some press lines are running totals — a week’s figure written as if it were today. For each report, confirm it, hold it, exclude it, or merge it with the same incident. Hold is a real answer. A missing report is not proof that nothing happened. When a ship is hit, the damage cable describes flooding, fire, and where the hull failed. It does not name a weapon. Tag the class you infer, or mark it unknown.",
  },
  {
    title: "You are graded on judgment.",
    body: "Bands on the plan are a median and a 5th-to-95th percentile, with the hidden posture still uncertain. They are not a promise about this seed. Every few mornings you give a probability. At the end you get a Brier score, a log score, a ledger score, and a replay of your exact decisions on many new seeds. That replay is how the game tells a lucky draw from a good policy. The seed can be shared. Same seed, same hidden month. Not the same decisions.",
  },
];

export function render(app: AppState): string {
  const page =
    app.screen === "start"
      ? startScreen(app)
      : app.screen === "tutorial"
        ? tutorialScreen(app)
        : app.screen === "debrief"
          ? debriefScreen(app)
          : playScreen(app);
  return `<div class="app">${page}</div>`;
}

export function planReadout(draft: Decisions, morning: Morning): string {
  const mine = cachedProject(draft, morning);
  const base = cachedProject(BASELINE, morning);
  return `${bandTable(mine, "This plan, held for seven days")}<p class="help">Steady baseline, same prior, same horizon: Strait flow ${escapeHtml(bandText(base.straitFlow))} mb/d. Ships damaged ${escapeHtml(bandText(base.damage, whole))}. The baseline is a comparison, not a recommendation to copy it.</p>`;
}

function startScreen(app: AppState): string {
  return `<a class="skip" href="#desk">Skip to the desk</a>
  <main class="start" id="desk">
    <p class="kicker">Trade coordination cell · fictional 2026</p>
    <h1>Strait</h1>
    <p class="lede">Thirty days as the coordinator during a Gulf shipping crisis. You will be wrong in public sometimes. The grade is whether you knew how unsure you were.</p>
    <div class="facts">
      <article><h2>Routes</h2><p>Strait, Fujairah, Yanbu. Southbound from Yanbu still has to pass Bab al-Mandab.</p></article>
      <article><h2>Reports</h2><p>Confirm, hold, exclude, or merge. A running total is not a daily count.</p></article>
      <article><h2>Score</h2><p>Probabilities, a ledger, damage cables, and a replay that separates luck from the policy.</p></article>
    </div>
    <div class="card">
      <label class="field" for="seed">Shared seed <span class="help">Leave blank for a new month. Any text is a valid seed.</span>
        <input id="seed" name="seed" type="text" autocomplete="off" value="${escapeHtml(app.seedInput)}" data-field="seed" />
      </label>
      <div class="row" style="margin-top:12px">
        <button class="btn btn-primary" type="button" data-action="begin">Begin the month</button>
        ${app.hasSave ? `<button class="btn" type="button" data-action="resume">Resume the saved month</button>` : ""}
        <button class="btn btn-ghost" type="button" data-action="rules">Rules</button>
      </div>
    </div>
    <p class="footer-note">Illustrative numbers, not a forecast and not advice for a real ship. No account, no server, nothing to install once this page is built. Parameters live in one commented config file.</p>
    ${rulesDialog(app)}
  </main>`;
}

function tutorialScreen(app: AppState): string {
  const step = TUTORIAL[app.tutorialStep];
  return `<main class="tutorial" id="desk">
    <p class="kicker">Before the first morning · ${app.tutorialStep + 1} of ${TUTORIAL.length}</p>
    <h1>${escapeHtml(step.title)}</h1>
    <p class="lede">${escapeHtml(step.body)}</p>
    <div class="row" style="margin-top:18px">
      <button class="btn" type="button" data-action="tutorial-back" ${app.tutorialStep === 0 ? "disabled" : ""}>Back</button>
      <button class="btn btn-primary" type="button" data-action="tutorial-next">${app.tutorialStep === TUTORIAL.length - 1 ? "Take the desk" : "Next"}</button>
      <button class="btn btn-ghost" type="button" data-action="tutorial-skip">Skip</button>
    </div>
  </main>`;
}

function playScreen(app: AppState): string {
  const world = simulate(app.seed, app.decisions);
  const liveDay = app.decisions.length + 1;
  const live = presentMorning(world, liveDay);
  const viewed = presentMorning(world, app.lookingAt ?? liveDay);
  const looking = app.lookingAt != null && app.lookingAt !== liveDay;
  const question = looking
    ? (app.answers.find((answer) => answer.question.askedDay === app.lookingAt)?.question ?? null)
    : questionForMorning(world, liveDay);
  const plan = looking ? app.decisions[(app.lookingAt ?? 1) - 1] ?? app.draft : app.draft;
  return `<a class="skip" href="#desk">Skip to the desk</a>
  <header class="topbar">
    <div class="brand"><strong>Strait</strong><span>Trade coordination cell</span></div>
    <p class="dayline">${live.finalMorning ? "Books closed" : `Day ${liveDay} of ${CONFIG.days}`}</p>
    <div class="meters">
      ${meter("Price index", oneDecimal(live.priceIndex), "Illustrative, 100 is the start")}
      ${meter("At anchor", whole(live.backlogShips), "Ships you can see")}
      ${meter("Pressure", `${whole(live.pressure)} ${pressureWord(live.pressure)}`, "Capitals, this morning")}
      ${meter("Official flow", live.releases.length ? `${oneDecimal(live.releases[live.releases.length - 1].printedMbPerDay)} mb/d` : "Pending", "Joint release, lagged")}
    </div>
    <div class="seedchip"><span class="kicker">Seed</span><code id="seed-code">${escapeHtml(app.seed)}</code>
      <button class="btn" type="button" data-action="copy-seed">${app.copied ? "Copied" : "Copy link"}</button>
    </div>
  </header>
  <div class="shell">
    <aside class="map-col">
      ${mapSvg(app.zone)}
      <div class="zone-list" role="group" aria-label="Zones">
        ${(["gulf", "strait", "oman", "yanbu", "bab"] as Zone[])
          .map(
            (zone) =>
              `<button type="button" data-action="zone" data-zone="${zone}" aria-pressed="${app.zone === zone}">${ZONE_LABEL[zone]}</button>`,
          )
          .join("")}
      </div>
      <p class="blurb">${escapeHtml(app.zone ? ZONE_BLURB[app.zone] : "Select a water to read what your allocation does there. The drawing is a schematic, not a chart.")}</p>
      ${sparkBlock(live)}
    </aside>
    <main class="desk" id="desk" aria-live="polite">
      ${tabs(app, live.finalMorning)}
      ${looking ? `<p class="card coach">Reading the morning of day ${app.lookingAt}. The ledger is still today’s book. <button class="btn" type="button" data-action="today">Return to today</button></p>` : ""}
      ${app.phase === "brief" ? brief(app, live, viewed, world, looking) : ""}
      ${app.phase === "ledger" ? ledger(app, live) : ""}
      ${app.phase === "plan" ? planPhase(app, plan, live, looking || live.finalMorning) : ""}
      ${app.phase === "forecast" ? forecastPhase(app, question, world, liveDay, looking || live.finalMorning) : ""}
    </main>
  </div>
  ${actionBar(app, live, question, looking)}
  ${rulesDialog(app)}`;
}

function brief(app: AppState, live: Morning, viewed: Morning, world: ReturnType<typeof simulate>, looking: boolean): string {
  const morning = looking ? viewed : live;
  const coach =
    !looking && live.day === 1
      ? `<section class="card coach"><h2>First morning</h2><p>Read the contested reports before you move ships. The day a report was filed is not always the day it happened. A figure that “has reached” a number is often a running total. The joint centre will not be in your inbox every morning. A quiet programme cable means your ships reported nothing. It does not mean the theatre was quiet. A damage cable says what was seen after a hit. It does not name a weapon.</p></section>`
      : "";
  const release = morning.newRelease
    ? `<section class="card"><h2>Official release</h2><p>Average Strait flow for days ${morning.newRelease.fromDay}–${morning.newRelease.toDay}: <strong>${oneDecimal(morning.newRelease.printedMbPerDay)} mb/d</strong>. Theatre total, rounded, with measurement error. Not your programme cable.</p></section>`
    : "";
  const notes = morning.yesterday
    ? `<section class="card"><h2>Direct return, day ${morning.yesterday.day}</h2>${morning.yesterday.operatorNotes.map((note) => `<p>${escapeHtml(note)}</p>`).join("")}</section>`
    : `<section class="card"><h2>The desk you inherited</h2><p>${whole(morning.backlogShips)} ships are already at anchor. The price index is ${oneDecimal(morning.priceIndex)}. The reports below were waiting when you arrived. Some describe the days before this watch.</p></section>`;
  const arrived = morning.newReports;
  const resolutions = looking
    ? ""
    : app.answers
        .filter((answer) => !answer.question.sealed && answer.question.revealDay === live.day)
        .map((answer) => {
          const outcome = tryResolve(answer.question, world);
          if (outcome == null) return "";
          const verb = outcome === 1 ? "It happened." : "It did not.";
          return `<p>Your forecast on day ${answer.question.askedDay} was ${percent(answer.probability)}. ${verb} ${escapeHtml(answer.question.text)}</p>`;
        })
        .join("");
  const resolutionCard = resolutions ? `<section class="card"><h2>A forecast resolves</h2>${resolutions}</section>` : "";
  const list =
    arrived.length === 0
      ? `<p class="quiet">No new contested reports this morning. A quiet inbox is not a quiet sea.</p>`
      : `<ul>${arrived
          .map(
            (report) =>
              `<li><span class="badge ${report.source}">${SOURCE_LABEL[report.source]}</span> ${escapeHtml(report.id)} · claimed ${report.claimedCount} · ${escapeHtml(zoneName(report.zone))}</li>`,
          )
          .join("")}</ul><p class="help">Open the ledger to confirm, hold, exclude, or merge. Do it before you treat the number as a count of new events.</p>`;
  const closing = live.finalMorning && !looking
    ? `<section class="card warn"><h2>The month is over</h2><p>Anything filed overnight is in the book. You can still correct the ledger. Then open the debrief. It will show the hidden log, your probabilities, and what your decisions do on other seeds.</p></section>`
    : "";
  return `${coach}${closing}${notes}${release}${resolutionCard}${damageBoard(app, morning, looking)}<section class="card"><h2>Contested reports overnight</h2>${list}</section>`;
}

function ledger(app: AppState, live: Morning): string {
  const reports = live.reports.filter((report) => {
    if (app.source !== "all" && report.source !== app.source) return false;
    const mark = app.ledger[report.id];
    if (app.ledgerMode === "new") return report.filedDay === live.day;
    if (app.ledgerMode === "open") return !mark || !mark.reviewed || mark.disposition === "hold";
    return true;
  });
  const counts = countMarks(live.reports, app.ledger);
  return `<section class="card">
    <h2>Ledger</h2>
    <p class="help">${counts.confirmed} confirmed, ${counts.held} held, ${counts.excluded} excluded, ${counts.merged} merged, ${counts.untouched} untouched. Untouched reports are abstentions. They do not raise the score.</p>
    <div class="filterbar" role="group" aria-label="Which reports">
      ${(["open", "new", "all"] as const)
        .map(
          (mode) =>
            `<button type="button" data-action="filter" data-mode="${mode}" aria-pressed="${app.ledgerMode === mode}">${mode === "open" ? "Still open" : mode === "new" ? "New today" : "All"}</button>`,
        )
        .join("")}
      <label class="field" style="min-width:180px">Source
        <select data-action="source" aria-label="Filter by source">
          <option value="all" ${app.source === "all" ? "selected" : ""}>All sources</option>
          ${(Object.keys(SOURCE_LABEL) as Source[])
            .map((source) => `<option value="${source}" ${app.source === source ? "selected" : ""}>${SOURCE_LABEL[source]}</option>`)
            .join("")}
        </select>
      </label>
    </div>
  </section>
  <details class="card"><summary>Programme log, for merging (${live.programmeEvents.length})</summary>
    ${live.programmeEvents.length === 0 ? `<p class="quiet">No programme incidents yet.</p>` : `<ul>${live.programmeEvents
      .map((event) => `<li><code>${event.id}</code> ${escapeHtml(programmeLabel(event))}</li>`)
      .join("")}</ul>`}
  </details>
  ${reports.length === 0 ? `<p class="card quiet">Nothing in this filter.</p>` : reports.map((report) => reportCard(report, app, live)).join("")}`;
}

function reportCard(report: PublicReport, app: AppState, live: Morning): string {
  const mark = app.ledger[report.id];
  const disposition = mark?.reviewed ? mark.disposition : "hold";
  const count = mark?.confirmCount ?? report.claimedCount;
  const options = mergeOptions(report.id, live, mark?.mergeTargetId);
  return `<article class="card report">
    <header>
      <div><span class="badge ${report.source}">${SOURCE_LABEL[report.source]}</span>
        <strong>${escapeHtml(report.id)}</strong>
        <span class="quiet">${report.damageReport ? "Damage report" : KIND_LABEL[report.kind]}</span></div>
      <div class="claim" aria-label="Claimed figure">${report.claimedCount}</div>
    </header>
    <p class="help">Filed ${escapeHtml(allegedLabel(report.filedDay))} · alleges ${escapeHtml(allegedLabel(report.allegedDay))} · ${escapeHtml(zoneName(report.zone))}</p>
    <p>${escapeHtml(report.text)}</p>
    <p class="help">${escapeHtml(SOURCE_HINT[report.source])}</p>
    <div class="actions" role="group" aria-label="Disposition for ${report.id}">
      ${(["hold", "exclude", "confirm", "merge"] as const)
        .map(
          (item) =>
            `<button type="button" data-action="ledger-set" data-report="${report.id}" data-disposition="${item}" aria-pressed="${disposition === item}">${labelDisposition(item)}</button>`,
        )
        .join("")}
    </div>
    ${
      disposition === "confirm"
        ? `<label class="field" for="count-${report.id}">Book this many separate incidents
            <input id="count-${report.id}" type="number" min="0" max="12" step="1" value="${count}" data-count="${report.id}" />
          </label>`
        : ""
    }
    ${
      disposition === "merge"
        ? `<label class="field" for="merge-${report.id}">Same incident as
            <select id="merge-${report.id}" data-merge="${report.id}">${options}</select>
          </label>`
        : ""
    }
  </article>`;
}

function planPhase(app: AppState, plan: Decisions, morning: Morning, locked: boolean): string {
  const clean = sanitizeDecision(plan);
  const slots = clean.escortStrait * CONFIG.shipsPerEscort;
  return `<section class="card">
    <h2>${locked ? "The plan that was committed" : "Today’s plan"}</h2>
    <p id="plan-summary">${escapeHtml(describePlan(clean))}</p>
    <p class="help">Strait escorts cover ${slots} ships today. You are calling ${clean.straitAttemptShips}. Owners under “defer” will not sail the unescorted ones. Under “caution”, about half of those unescorted ships stay behind. Larger convoys mean fewer separate exposures and a fatter tail if one transit goes wrong.</p>
    ${locked ? "" : planControls(app)}
  </section>
  <section class="card" id="plan-readout">
    <h2>What the model will say</h2>
    ${planReadout(clean, morning)}
  </section>`;
}

function planControls(app: AppState): string {
  const d = app.draft;
  return `<div class="row">
    ${stepper("escortStrait", "Escorts, Strait", d.escortStrait, reserveEscorts(d) <= 0)}
    ${stepper("escortOman", "Escorts, Oman", d.escortOman, reserveEscorts(d) <= 0)}
    ${stepper("escortBab", "Escorts, Bab", d.escortBab, reserveEscorts(d) <= 0)}
    <p class="help">Reserve ${reserveEscorts(d)} of ${CONFIG.escortPool}. A reserve escort covers nobody.</p>
  </div>
  <div class="row">
    ${stepper("mcmStrait", "Sweepers, Strait", d.mcmStrait, reserveMcm(d) <= 0)}
    ${stepper("mcmOman", "Sweepers, Oman", d.mcmOman, reserveMcm(d) <= 0)}
    ${stepper("mcmBab", "Sweepers, Bab", d.mcmBab, reserveMcm(d) <= 0)}
    <p class="help">Stood down ${reserveMcm(d)} of ${CONFIG.mcmPool}. Clearance is slow.</p>
  </div>
  <div class="row">
    ${stepper("straitAttemptShips", "Programme ships called", d.straitAttemptShips, d.straitAttemptShips >= CONFIG.maxProgrammeShips)}
    <div class="field"><span id="convoy-label">Convoy size</span><div class="choice" role="group" aria-labelledby="convoy-label">
      ${([2, 4, 8, 12] as const)
        .map(
          (size) =>
            `<button type="button" data-action="convoy" data-size="${size}" aria-pressed="${d.convoySize === size}">${size}</button>`,
        )
        .join("")}
    </div></div>
  </div>
  <div class="row">
    ${slider("fujairahMb", "Fujairah nomination, mb/d", d.fujairahMb, 0, CONFIG.fujairahCapacityMb, 0.1, oneDecimal)}
    ${slider("yanbuMb", "Yanbu nomination, mb/d", d.yanbuMb, 0, CONFIG.yanbuCapacityMb, 0.1, oneDecimal)}
    ${slider("yanbuSouthShare", "Yanbu share that sails south", d.yanbuSouthShare * 100, 0, 100, 5, (n) => `${Math.round(n)}%`)}
  </div>
  <p class="help">Southbound Yanbu cargo must pass Bab al-Mandab. Northbound cargo goes via Suez and does not.</p>
  ${choiceRow("guidance", "Guidance to owners", d.guidance, [
    ["sail", "Sail as planned", "Escorted and unescorted programme ships both go. Other traffic stays busy. A reassuring price if the day is quiet, a harder political landing if it is not."],
    ["caution", "Heightened caution", "Escorted ships sail. About half of the unescorted programme stays at anchor. Other traffic thins."],
    ["defer", "Defer unescorted", "Only escorted programme ships sail. Other traffic drops. The anchorage, and then shut-in loadings, take the rest."],
  ])}
  ${choiceRow("message", "Public line", d.message, [
    ["reassure", "Reassure", "Leans the price down today. If ships are hit anyway, pressure jumps."],
    ["factual", "Factual", "No nudge either way. The line does not forecast a number."],
    ["warn", "Warn", "Leans the price up. A warning that runs through a long quiet stretch starts to cost you."],
    ["silent", "No comment", "A small uncertainty premium, and no hostage to a sentence."],
  ])}`;
}

function forecastPhase(
  app: AppState,
  question: ReturnType<typeof questionForMorning>,
  world: ReturnType<typeof simulate>,
  liveDay: number,
  locked: boolean,
): string {
  const past = app.answers
    .map((answer) => {
      const outcome = answer.question.sealed || (answer.question.revealDay ?? 99) > liveDay ? null : tryResolve(answer.question, world);
      const result =
        outcome == null
          ? answer.question.sealed
            ? "Sealed until the debrief."
            : "Not yet resolved."
          : outcome === 1
            ? "Resolved: yes."
            : "Resolved: no.";
      return `<li><strong>${percent(answer.probability)}</strong> on day ${answer.question.askedDay}. ${escapeHtml(answer.question.text)} <span class="quiet">${result}</span></li>`;
    })
    .join("");
  const today =
    locked || !question
      ? `<p class="quiet">${question ? "This question is already in the book." : "No new question this morning."}</p>`
      : `<section class="card">
          <h2>Probability</h2>
          <p>${escapeHtml(question.text)}</p>
          <p class="help">${escapeHtml(question.detail)}</p>
          <label class="field" for="forecast">Your probability <strong id="forecast-readout">${app.forecastDraft}%</strong>
            <input id="forecast" type="range" min="0" max="100" step="1" value="${app.forecastDraft}" data-forecast="1" />
          </label>
          <p class="help">The handle starts at ${app.forecastDraft}% and is not recorded until you move it or press the button. 50% means you think it is as likely as not. The score punishes false confidence more than a mild error.</p>
          <button class="btn" type="button" data-action="forecast-record">Record ${app.forecastDraft}%</button>
          ${app.forecastTouched ? `<p class="help">Recorded for this morning, and still editable until you commit the day.</p>` : ""}
        </section>`;
  return `${today}<section class="card"><h2>Forecasts already made</h2>${past ? `<ul>${past}</ul>` : `<p class="quiet">None yet.</p>`}</section>`;
}

function actionBar(app: AppState, live: Morning, question: ReturnType<typeof questionForMorning>, looking: boolean): string {
  const needForecast = !looking && !live.finalMorning && question != null && !app.forecastTouched;
  const label = live.finalMorning ? "Open the debrief" : looking ? "Commit is closed while you are reading back" : "Commit the day";
  return `<div class="actionbar">
    <div class="dayrail" aria-label="Days">${Array.from({ length: CONFIG.days }, (_, i) => {
      const day = i + 1;
      const liveDay = app.decisions.length + 1;
      const current = !looking && day === liveDay;
      const exists = day <= app.decisions.length || day === liveDay;
      return `<button type="button" data-action="look" data-day="${day}" ${exists ? "" : "disabled"} aria-current="${current}">${day}</button>`;
    }).join("")}</div>
    <div class="row">
      ${
        live.finalMorning
          ? `<button class="btn btn-primary" type="button" id="commit" data-action="debrief">Open the debrief</button>`
          : `<button class="btn btn-primary" type="button" id="commit" data-action="commit" ${needForecast || looking ? "disabled" : ""}>${label}</button>`
      }
      <button class="btn btn-ghost" type="button" data-action="rules">Rules</button>
      <button class="btn btn-ghost" type="button" data-action="abandon">${app.abandonArmed ? "Confirm abandon" : "Abandon"}</button>
    </div>
    <p class="help">${needForecast ? "Set today’s probability before you commit." : "Decisions stick. Change only what should change."}</p>
  </div>`;
}

function debriefScreen(app: AppState): string {
  if (app.scoring || !app.scorecard) {
    return `<main class="debrief" id="desk"><p class="kicker">Closing the books</p><h1>Replaying the month.</h1><p class="lede">Same decisions, ${CONFIG.replaySamples} new seeds, plus the baseline on those same seeds. This is the part that separates a lucky draw from a policy.</p></main>`;
  }
  const card = app.scorecard;
  const world = simulate(app.seed, app.decisions);
  const sys = bandFrom(card.playerSystem);
  const baseSys = bandFrom(card.baselineSystem);
  const dmg = bandFrom(card.playerDamage);
  const baseDmg = bandFrom(card.baselineDamage);
  const cas = bandFrom(card.playerCasualties);
  const baseCas = bandFrom(card.baselineCasualties);
  return `<a class="skip" href="#desk">Skip to the debrief</a>
  <main class="debrief" id="desk">
    <p class="kicker">Debrief · seed ${escapeHtml(app.seed)}</p>
    <div class="scorehead">
      <h1>${escapeHtml(card.judgmentLabel)}</h1>
      <p><span class="kicker">Judgment score</span><br><strong>${whole(card.judgment)}</strong></p>
    </div>
    <p class="help">${escapeHtml(weightLine(card))} This is a grade of the record, not a model prediction.</p>
    <div class="facts">
      <article><h2>Forecasts</h2><p><strong>${whole(card.forecastPoints)}</strong> / 100</p><p>Brier ${card.brier == null ? "—" : card.brier.toFixed(3)} (lower is better; 0.25 is a constant 50%). Log score ${card.logScore == null ? "—" : card.logScore.toFixed(3)} (closer to zero is better).</p></article>
      <article><h2>Ledger</h2><p><strong>${whole(card.ledger.points)}</strong> / 100</p><p>${card.ledger.accuracy == null ? "No graded calls. Abstention is a 40, and it is not a pass." : `${card.ledger.right} right, ${card.ledger.wrong} wrong, ${card.ledger.abstain} held.`} Accuracy is only over the calls you actually made.</p></article>
      <article><h2>Operations</h2><p><strong>${whole(card.operationalPoints)}</strong> / 100</p><p>60 is matching the steady baseline’s mean utility. The mean, not the median, so a fat tail of casualties counts.</p></article>
      <article><h2>Damage cables</h2><p><strong>${card.damage.points == null ? "—" : whole(card.damage.points)}</strong> / 100</p><p>${escapeHtml(damageBlurb(card))}</p></article>
    </div>
    <section class="card">
      <h2>Luck and judgment</h2>
      <p>${escapeHtml(card.luckNote)}</p>
      <p>${escapeHtml(card.judgmentNote)}</p>
      <p class="help">${escapeHtml(card.distributionNote)}</p>
      <table>
        <caption>This seed beside the distribution of the same decisions, and beside a steady baseline on the same seeds. Model outputs are a median and a 5th–95th. “This seed” is what happened.</caption>
        <thead><tr><th>Outcome</th><th>This seed</th><th>Your decisions</th><th>Baseline</th></tr></thead>
        <tbody>
          <tr><td>System flow, mb/d</td><td class="num">${oneDecimal(card.actual.meanSystemMb)}</td><td class="num">${escapeHtml(bandText(sys))}</td><td class="num">${escapeHtml(bandText(baseSys))}</td></tr>
          <tr><td>Strait flow, mb/d</td><td class="num">${oneDecimal(card.actual.meanStraitMb)}</td><td class="num">${escapeHtml(bandText(bandFrom(card.playerStrait)))}</td><td class="num">${escapeHtml(bandText(bandFrom(card.baselineStrait)))}</td></tr>
          <tr><td>Ships damaged</td><td class="num">${whole(card.actual.totalDamage)}</td><td class="num">${escapeHtml(bandText(dmg, whole))}</td><td class="num">${escapeHtml(bandText(baseDmg, whole))}</td></tr>
          <tr><td>Crew casualties</td><td class="num">${whole(card.actual.totalCasualties)}</td><td class="num">${escapeHtml(bandText(cas, whole))}</td><td class="num">${escapeHtml(bandText(baseCas, whole))}</td></tr>
        </tbody>
      </table>
      <p class="help">This seed also ended at a price index of ${oneDecimal(card.actual.endPrice)}, pressure ${whole(card.actual.endPressure)} (${pressureWord(card.actual.endPressure)}), and ${whole(card.actual.endBacklog)} ships still at anchor. Crew missing, included in the casualties: ${whole(card.actual.totalMissing)}. Illustrative counts, not a record of any real voyage.</p>
      <div class="legend"><span><i class="swatch" style="background:#1a4742"></i>Your decisions</span><span><i class="swatch" style="background:#8d3b2c"></i>Baseline</span></div>
      <h3>Ships damaged</h3>
      ${histogram(
        [
          { values: card.playerDamage, color: "#1a4742", name: "Your decisions" },
          { values: card.baselineDamage, color: "#8d3b2c", name: "Baseline" },
        ],
        card.actual.totalDamage,
        whole,
      )}
      <h3>Crew casualties</h3>
      ${histogram(
        [
          { values: card.playerCasualties, color: "#1a4742", name: "Your decisions" },
          { values: card.baselineCasualties, color: "#8d3b2c", name: "Baseline" },
        ],
        card.actual.totalCasualties,
        whole,
      )}
    </section>
    <section class="card">
      <h2>Where the bookkeeping went wrong</h2>
      ${
        card.mistakes.length
          ? card.mistakes.map((mistake) => `<p class="mistake">${escapeHtml(mistake.text)}</p>`).join("")
          : `<p>None of the bookkeeping failures this exercise tracks turned up. Read the comparison before you treat that as a clean bill. A right number reached by counting a running total would have been named above.</p>`
      }
    </section>
    ${damageDebrief(card)}
    <section class="card">
      <h2>Forecasts</h2>
      ${calibrationChart(
        card.forecasts.filter((answer) => answer.outcome != null).map((answer) => ({ p: answer.probability, y: answer.outcome ?? 0 })),
        card.calibration,
      )}
      <p class="help">Circles are individual forecasts, nudged so they do not stack. Squares are bins. With this few questions, an empty bin means nothing. The table is the accessible version.</p>
      <table>
        <caption>Calibration. Your stated probability against how often the event happened.</caption>
        <thead><tr><th>You said</th><th>Questions</th><th>Mean probability</th><th>How often it happened</th></tr></thead>
        <tbody>${card.calibration
          .map(
            (bin) =>
              `<tr><td>${bin.label}</td><td class="num">${bin.n}</td><td class="num">${bin.n ? percent(bin.meanP) : "—"}</td><td class="num">${bin.n ? percent(bin.frequency) : "—"}</td></tr>`,
          )
          .join("")}</tbody>
      </table>
      <ul>${card.forecasts
        .map((answer) => {
          const happened = answer.outcome === 1 ? "yes" : answer.outcome === 0 ? "no" : "unresolved";
          return `<li>${percent(answer.probability)} → ${happened}. ${escapeHtml(answer.question.text)}</li>`;
        })
        .join("")}</ul>
    </section>
    <section class="card">
      <h2>The posture you could not see</h2>
      <p>Revealed adversary posture, one point per day. This is the hidden path, not a forecast. Escorts barely moved it. They changed who was exposed.</p>
      ${postureChart(world.days.map((day) => day.posture))}
    </section>
    <details class="card"><summary>Ledger, claim by claim (${card.ledger.rows.length})</summary>
      <table>
        <thead><tr><th>Report</th><th>Your call</th><th>The truth</th><th>Grade</th></tr></thead>
        <tbody>${card.ledger.rows
          .map(
            (row) =>
              `<tr><td><code>${escapeHtml(row.reportId)}</code></td><td>${escapeHtml(row.belief)}</td><td>${escapeHtml(row.truth)}</td><td class="${row.grade}">${row.grade}</td></tr>`,
          )
          .join("")}</tbody>
      </table>
    </details>
    ${trueLog(world, app.ledger)}
    <div class="row">
      <button class="btn btn-primary" type="button" data-action="new-month">New month</button>
      <button class="btn" type="button" data-action="copy-seed">${app.copied ? "Copied" : "Copy seed link"}</button>
    </div>
    <p class="footer-note">Utility this seed: ${oneDecimal(card.actualUtility)}. Mean utility of the replays: ${oneDecimal(mean(card.playerUtility))}. Baseline mean: ${oneDecimal(mean(card.baselineUtility))}. ${escapeHtml(judgmentWord(card.judgment))}.</p>
  </main>`;
}

function trueLog(world: ReturnType<typeof simulate>, marks: Record<string, LedgerMark>): string {
  const days = Array.from(new Set(world.events.map((event) => event.day))).sort((a, b) => a - b);
  const body = days
    .map((day) => {
      const events = world.events.filter((event) => event.day === day);
      const reports = world.reports.filter((report) => report.allegedDay === day);
      return `<div class="log-day"><h3>${escapeHtml(allegedLabel(day))}</h3>
        <ul>${events.map((event) => `<li>${escapeHtml(hiddenEventLine(event))}</li>`).join("") || "<li>No event logged.</li>"}</ul>
        ${
          reports.length
            ? `<ul>${reports
                .map((report) => {
                  const mark = marks[report.id];
                  const belief = !mark || !mark.reviewed ? "You left it unreviewed." : `${mark.disposition}${mark.disposition === "confirm" ? ` ${mark.confirmCount ?? report.claimedCount}` : ""}${mark.mergeTargetId ? ` → ${mark.mergeTargetId}` : ""}.`;
                  return `<li><code>${escapeHtml(report.id)}</code> ${escapeHtml(SOURCE_LABEL[report.source])}, claimed ${report.claimedCount}. ${escapeHtml(belief)}</li>`;
                })
                .join("")}</ul>`
            : `<p class="quiet">No contested report alleged this day.</p>`
        }
      </div>`;
    })
    .join("");
  return `<details class="card"><summary>Hidden log beside your book</summary>${body}</details>`;
}

function rulesDialog(app: AppState): string {
  if (!app.rulesOpen) return "";
  return `<dialog open aria-labelledby="rules-title">
    <h2 id="rules-title">How a day works</h2>
    <p>Read the direct return and the new reports. Update the ledger. Set the plan. If there is a question, give a probability. Commit. The next morning shows what your own ships reported, plus whatever claims arrived. It does not show the true theatre totals.</p>
    <p>Confirm means “book this as separate incidents,” and you set how many. Merge means “this is the same incident as a programme-log entry or another report.” Exclude means “not a real separate incident.” Hold means “I am not calling it.”</p>
    <p>When a ship is hit, the damage cable says what was seen: flooding, fire, where the hull failed, and whether the ship can still move. It does not name a weapon. Tag mine, one-way drone, missile, or unknown. Unknown is not penalized when the cable leaves the height of the breach unresolved.</p>
    <p>Official flow questions resolve when the release prints. Questions about true incident counts stay sealed until the debrief, because the truth is not in the inbox. The plan’s bands use the published parameters and a prior on posture. They do not look at this seed.</p>
    <p>Illustrative throughout. Not a forecast, not operational advice, and not a way to plan harm.</p>
    <button class="btn btn-primary" type="button" data-action="rules-close">Close</button>
  </dialog>`;
}

function tabs(app: AppState, finalMorning: boolean): string {
  const items: Array<[Phase, string]> = finalMorning
    ? [
        ["brief", "Brief"],
        ["ledger", "Ledger"],
        ["forecast", "Forecasts"],
      ]
    : [
        ["brief", "Brief"],
        ["ledger", "Ledger"],
        ["plan", "Plan"],
        ["forecast", "Forecast"],
      ];
  return `<div class="tabs" role="tablist">${items
    .map(
      ([phase, label]) =>
        `<button type="button" role="tab" data-action="phase" data-phase="${phase}" aria-selected="${app.phase === phase}">${label}</button>`,
    )
    .join("")}</div>`;
}

function meter(label: string, value: string, hint: string): string {
  return `<div class="meter"><span>${label}</span><b>${escapeHtml(value)}</b><span>${hint}</span></div>`;
}

function sparkBlock(morning: Morning): string {
  const flows = morning.history.map((day) => day.programmeStraitFlowMb);
  const marks = morning.releases.map((release) => ({
    index: Math.min(flows.length - 1, release.toDay - 1),
    label: `Official ${oneDecimal(release.printedMbPerDay)} covering through day ${release.toDay}`,
  }));
  return `<section class="card"><h3>Your Strait oil</h3><p class="help">Programme million barrels by day. Dots mark mornings with an official release, plotted on the last day of that window. The dot is not the official number.</p>${flows.length ? sparkline(flows, marks) : `<p class="quiet">The first cable arrives tomorrow.</p>`}</section>`;
}

function stepper(field: string, label: string, value: number, plusLocked: boolean): string {
  return `<div class="field"><span id="lab-${field}">${label}</span><div class="stepper" role="group" aria-labelledby="lab-${field}">
    <button type="button" data-action="step" data-field="${field}" data-dir="-1" aria-label="Decrease ${label}">−</button>
    <b>${value}</b>
    <button type="button" data-action="step" data-field="${field}" data-dir="1" aria-label="Increase ${label}" ${plusLocked ? "disabled" : ""}>+</button>
  </div></div>`;
}

function slider(
  field: string,
  label: string,
  value: number,
  min: number,
  max: number,
  step: number,
  fmt: (n: number) => string,
): string {
  return `<label class="field" for="${field}">${label} <strong id="val-${field}">${fmt(value)}</strong>
    <input id="${field}" type="range" min="${min}" max="${max}" step="${step}" value="${value}" data-field="${field}" />
  </label>`;
}

function choiceRow(
  group: "guidance" | "message",
  legend: string,
  current: string,
  options: Array<[Guidance | PublicMessage, string, string]>,
): string {
  return `<fieldset class="card" style="margin:0 0 12px"><legend>${legend}</legend><div class="choice">
    ${options
      .map(
        ([value, label]) =>
          `<button type="button" data-action="${group}" data-value="${value}" aria-pressed="${current === value}">${label}</button>`,
      )
      .join("")}
  </div>
  ${options.map(([, label, help]) => `<p class="help"><strong>${label}.</strong> ${help}</p>`).join("")}
  </fieldset>`;
}

function bandTable(projection: Projection, caption: string): string {
  const row = (label: string, band: Projection["straitFlow"], fmt: (n: number) => string, unit: string) =>
    `<tr><td>${label}</td><td class="num">${fmt(band.low)}${unit}</td><td class="num">${fmt(band.median)}${unit}</td><td class="num">${fmt(band.high)}${unit}</td></tr>`;
  return `<table>
    <caption>${caption}. ${projection.samples} draws, posture and mine hazard from the prior, not from this seed. Median and 5th–95th percentile. Not a point forecast.</caption>
    <thead><tr><th>Outcome</th><th>5th</th><th>Median</th><th>95th</th></tr></thead>
    <tbody>
      ${row("Strait flow", projection.straitFlow, oneDecimal, " mb/d")}
      ${row("System flow", projection.systemFlow, oneDecimal, " mb/d")}
      ${row("Ships damaged", projection.damage, whole, "")}
      ${row("Crew casualties", projection.casualties, whole, "")}
      ${row("Ships at anchor", projection.backlog, whole, "")}
    </tbody>
  </table>`;
}

function mergeOptions(selfId: string, morning: Morning, selected: string | undefined): string {
  const programme = morning.programmeEvents
    .slice(-30)
    .map((event) => `<option value="${event.id}" ${selected === event.id ? "selected" : ""}>${escapeHtml(event.id)} · ${escapeHtml(programmeLabel(event))}</option>`);
  const reports = morning.reports
    .filter((report) => report.id !== selfId)
    .slice(-40)
    .map(
      (report) =>
        `<option value="${report.id}" ${selected === report.id ? "selected" : ""}>${escapeHtml(report.id)} · ${SOURCE_LABEL[report.source]} · ${escapeHtml(zoneName(report.zone))} · claimed ${report.claimedCount}</option>`,
    );
  return `<option value="">Select the same incident</option>${programme.join("")}${reports.join("")}`;
}

function programmeLabel(event: PublicProgrammeEvent): string {
  const when = event.day >= 1 ? `day ${event.day}` : allegedLabel(event.day);
  if (event.damageReport) {
    const state = event.condition ? conditionShort(event.condition) : "hull damage";
    return `${when} · ${ZONE_LABEL[event.zone]} · hull damage · ${state}`;
  }
  return `${when} · ${ZONE_LABEL[event.zone]} · ${KIND_LABEL[event.kind]} · damaged ${event.shipsDamaged}`;
}

function damageBoard(app: AppState, morning: Morning, looking: boolean): string {
  if (morning.damageCases.length === 0) return "";
  const note = looking
    ? "Reading an earlier morning. The cables below are what you had then. Tags stay on today’s book."
    : "These cables say what was observed after a hit. They do not name a weapon. Tag the class the evidence supports. Unknown is not penalized when the height of the breach is unresolved, or when an above-waterline cable does not separate the classes.";
  return `<section class="card"><h2>Damage cables</h2><p class="help">${note}</p></section>${morning.damageCases
    .map((item) => damageCard(item, app.weaponTags[item.eventId], looking))
    .join("")}`;
}

function damageCard(item: PublicDamageCase, tag: WeaponTag | undefined, looking: boolean): string {
  const call = tag?.call ?? "unknown";
  const confidence = tag?.confidence ?? "medium";
  const when = item.day >= 1 ? `Day ${item.day}` : allegedLabel(item.day);
  const place = item.programme ? zoneName(item.zone) : "other traffic";
  const stage = item.stage === "full" ? "Follow-up survey is in." : "Initial report. A fuller survey may follow.";
  const controls = looking
    ? `<p class="help">On the book: ${escapeHtml(callLabel(call))}${call === "unknown" ? "" : `, ${confidence} confidence`}.</p>`
    : `${callButtons(item.eventId, call)}${call === "unknown" ? "" : confidenceButtons(item.eventId, confidence)}`;
  return `<article class="card damage">
    <header><div><strong>${escapeHtml(item.eventId)}</strong> <span class="quiet">${escapeHtml(when)} · ${escapeHtml(place)} · ${escapeHtml(conditionShort(item.condition))}</span></div></header>
    <p>${escapeHtml(item.text)}</p>
    <p class="help">${stage}</p>
    ${controls}
  </article>`;
}

function callButtons(eventId: string, call: WeaponCall): string {
  const options: Array<[WeaponCall, string]> = [
    ["mine", "Mine"],
    ["drone", "One-way drone"],
    ["missile", "Missile"],
    ["unknown", "Unknown"],
  ];
  return `<div class="actions" role="group" aria-label="Suspected weapon for ${escapeHtml(eventId)}">${options
    .map(
      ([value, label]) =>
        `<button type="button" data-action="weapon-call" data-event="${escapeHtml(eventId)}" data-call="${value}" aria-pressed="${call === value}">${label}</button>`,
    )
    .join("")}</div>`;
}

function confidenceButtons(eventId: string, confidence: CallConfidence): string {
  const options: Array<[CallConfidence, string]> = [
    ["low", "Low confidence"],
    ["medium", "Medium"],
    ["high", "High confidence"],
  ];
  return `<div class="actions" role="group" aria-label="Confidence for ${escapeHtml(eventId)}">${options
    .map(
      ([value, label]) =>
        `<button type="button" data-action="weapon-confidence" data-event="${escapeHtml(eventId)}" data-confidence="${value}" aria-pressed="${confidence === value}">${label}</button>`,
    )
    .join("")}</div><p class="help">A correct call scores more when you are sure. A wrong call costs more when you are sure.</p>`;
}

function weightLine(card: Scorecard): string {
  const weights = judgmentWeights(card.damage.points != null);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const damage =
    weights.damage > 0 ? `, ${pct(weights.damage)} damage cables` : ". No damage cable was shown, so that weight was spread across the other three";
  return `Weighted ${pct(weights.forecast)} forecasts, ${pct(weights.ledger)} ledger, ${pct(weights.operational)} the mean outcome of these decisions across seeds${damage}.`;
}

function damageBlurb(card: Scorecard): string {
  const grade = card.damage;
  if (grade.points == null) return "No hit was shown to the desk, so this weight was redistributed.";
  return `${grade.correct} right, ${grade.wrong} wrong, ${grade.unknown} unknown. Unknown is not penalized when the cable was ambiguous. A confident wrong call costs more than a hesitant one.`;
}

function damageDebrief(card: Scorecard): string {
  const grade = card.damage;
  if (grade.rows.length === 0) {
    return `<section class="card"><h2>Damage cables</h2><p>No damaging hit was shown to the desk. There is nothing to grade, and that part of the weight was spread across the other scores.</p></section>`;
  }
  const rows = grade.rows
    .map((row) => {
      const gradeClass = row.call === "unknown" ? "abstain" : row.call === row.weapon ? "right" : "wrong";
      const yours = `${callLabel(row.call)}${row.confidence ? ` · ${row.confidence}` : ""}`;
      return `<tr><td><code>${escapeHtml(row.eventId)}</code></td><td>${escapeHtml(yours)}</td><td>${escapeHtml(weaponLabel(row.weapon))}</td><td class="${gradeClass}">${escapeHtml(row.note)}</td></tr>`;
    })
    .join("");
  const cables = grade.rows
    .map((row) => `<p><code>${escapeHtml(row.eventId)}</code> ${escapeHtml(row.evidence)}</p>`)
    .join("");
  return `<section class="card"><h2>Damage cables</h2><p>${escapeHtml(damageBlurb(card))}</p><p class="help">A mine signature sits below the waterline: flooding, list, settling by the bow or stern, sometimes keel damage, and often no fire. A drone or a missile sits above it: fire, smoke, a hole above the waterline, or damage to the superstructure or the bridge. The engine room and the steering gear are aft and low. If the cable cannot place the height of that breach, both stay plausible, and unknown is not penalized.</p>
    <table>
      <caption>Your weapon call beside the hidden class.</caption>
      <thead><tr><th>Hit</th><th>Your call</th><th>True class</th><th>Score</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <details><summary>Cables you were shown</summary>${cables}</details>
  </section>`;
}

function hiddenEventLine(event: ReturnType<typeof simulate>["events"][number]): string {
  if (!event.damage) return event.summary;
  const cable = playerCable(event.damage, event.damage.full, {
    casualties: event.casualties,
    missing: event.missing,
  });
  return `${cable} True weapon: ${weaponLabel(event.damage.weapon)}.`;
}

function labelDisposition(item: LedgerMark["disposition"]): string {
  if (item === "hold") return "Hold";
  if (item === "exclude") return "Exclude";
  if (item === "confirm") return "Confirm";
  return "Merge";
}

function countMarks(reports: PublicReport[], ledger: Record<string, LedgerMark>) {
  const counts = { confirmed: 0, held: 0, excluded: 0, merged: 0, untouched: 0 };
  for (const report of reports) {
    const mark = ledger[report.id];
    if (!mark || !mark.reviewed) counts.untouched += 1;
    else if (mark.disposition === "confirm") counts.confirmed += 1;
    else if (mark.disposition === "exclude") counts.excluded += 1;
    else if (mark.disposition === "merge") counts.merged += 1;
    else counts.held += 1;
  }
  return counts;
}

function bandFrom(values: number[]) {
  return { low: quantile(values, 0.05), median: quantile(values, 0.5), high: quantile(values, 0.95) };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

const projectCache = new Map<string, Projection>();

function cachedProject(plan: Decisions, morning: Morning): Projection {
  const key = JSON.stringify(sanitizeDecision(plan)) + `|${morning.backlogShips}|${oneDecimal(morning.priceIndex)}`;
  const hit = projectCache.get(key);
  if (hit) return hit;
  const value = projectPlan(sanitizeDecision(plan), {
    backlogShips: morning.backlogShips,
    priceIndex: morning.priceIndex,
  });
  projectCache.set(key, value);
  return value;
}
