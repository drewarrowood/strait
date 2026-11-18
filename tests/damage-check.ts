import { CONFIG } from "../src/config";
import {
  assessHit,
  assessWeapon,
  factsAreAboveWaterlineOnly,
  gradeDamageCalls,
  isAboveWaterlineOnly,
  makeCompartmentOnlyReport,
  scaleDamageScore,
  scoreWeaponCall,
} from "../src/damage";
import { BASELINE } from "../src/decide";
import { simulate } from "../src/model";
import { presentMorning } from "../src/present";
import { mulberry32 } from "../src/rng";
import { buildScorecard } from "../src/score";
import type { WeaponClass, WeaponTag } from "../src/types";

const WEAPON_WORD = /\b(mine|drone|missile)\b/i;
const ABOVE_HEIGHT = /height of breach: above/i;

function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new Error(message);
}

function assertMineSafe(weapon: WeaponClass, seed: number): void {
  const hit = assessWeapon(weapon, mulberry32(seed));
  if (weapon !== "mine") return;
  assert(!factsAreAboveWaterlineOnly(hit), `mine facts above-only at ${seed}`);
  assert(hit.holeAboveWaterline === false, "mine hole above the waterline");
  assert(hit.superstructureDamage === false, "mine superstructure");
  assert(hit.bridgeDamage === false, "mine bridge");
  assert(hit.localizedImpact === false, "mine localized impact");
  assert(hit.heavyBlast === false, "mine blast");
  for (const report of [hit.early, hit.full]) {
    assert(!isAboveWaterlineOnly(report), `mine report above-only at ${seed}`);
    assert(report.heightOfBreach !== "above", "mine height marked above");
    assert(!ABOVE_HEIGHT.test(report.text), "mine text places the breach above the waterline");
    assert(!WEAPON_WORD.test(report.text), `weapon word in mine cable: ${report.text}`);
  }
}

function assertCompartmentOnly(compartment: "engine-room" | "steering-gear", stage: "early" | "full", symptom: "fire" | "damaged"): void {
  const report = makeCompartmentOnlyReport(compartment, stage, symptom);
  assert(report.heightOfBreach === "unknown", "compartment-only height");
  assert(report.ambiguity === "height", "compartment-only ambiguity");
  assert(report.compartmentOnly, "compartment-only flag");
  assert(report.compartment === compartment, "compartment-only place");
  assert(!isAboveWaterlineOnly(report), "compartment-only classified as above-waterline");
  assert(report.text.toLowerCase().includes("height of breach unknown"), report.text);
  assert(report.text.includes("both a below-waterline hit and an above-waterline hit stay plausible"), report.text);
  assert(!WEAPON_WORD.test(report.text), report.text);
  if (symptom === "fire" && compartment === "engine-room") assert(report.text.includes("Engine room fire"), report.text);
  if (symptom === "damaged" && compartment === "steering-gear") assert(report.text.includes("Steering gear damaged"), report.text);
}

let compartmentCases = 0;
let aboveOnlyReports = 0;
for (let i = 1; i <= 500; i++) {
  assertMineSafe("mine", i);
  const mine = assessWeapon("mine", mulberry32(i));
  for (const report of [mine.early, mine.full]) {
    if (!report.compartmentOnly) continue;
    compartmentCases += 1;
    assert(report.heightOfBreach === "unknown", "random compartment-only height");
    assert(report.ambiguity === "height", "random compartment-only ambiguity");
    assert(report.text.toLowerCase().includes("height of breach unknown"), report.text);
    const compartment = report.compartment;
    assert(compartment === "engine-room" || compartment === "steering-gear", "aft-low compartment");
  }
  const other = assessWeapon(i % 2 === 0 ? "drone" : "missile", mulberry32(50_000 + i));
  for (const report of [other.early, other.full]) {
    assert(!WEAPON_WORD.test(report.text), report.text);
    if (report.compartmentOnly) {
      assert(report.heightOfBreach === "unknown", "above-class compartment-only height");
      assert(report.text.toLowerCase().includes("height of breach unknown"), report.text);
    }
    if (isAboveWaterlineOnly(report)) aboveOnlyReports += 1;
  }
}

assert(compartmentCases > 0, "expected some aft-low mine cables to withhold breach height");
assert(aboveOnlyReports > 0, "expected some drone or missile cables to be above-waterline-only");

for (const compartment of ["engine-room", "steering-gear"] as const) {
  for (const stage of ["early", "full"] as const) {
    for (const symptom of ["fire", "damaged"] as const) assertCompartmentOnly(compartment, stage, symptom);
  }
}

const sameA = assessHit("shared", "e4", "security");
const sameB = assessHit("shared", "e4", "security");
assert(JSON.stringify(sameA) === JSON.stringify(sameB), "same seed and event should rebuild the same signature");
assert(!factsAreAboveWaterlineOnly(assessHit("shared", "e4", "mine")), "assessHit mine");

const unknownAmbiguous = scoreWeaponCall({
  weapon: "mine",
  call: "unknown",
  confidence: "high",
  ambiguity: "height",
});
assert(unknownAmbiguous.raw === 0, "unknown on a height-unknown cable is not penalized");
assert(/not penalized/.test(unknownAmbiguous.note), unknownAmbiguous.note);

const unknownClass = scoreWeaponCall({
  weapon: "drone",
  call: "unknown",
  confidence: "high",
  ambiguity: "class",
});
assert(unknownClass.raw === 0, "unknown on an unresolved above-waterline class is not penalized");

const unknownClear = scoreWeaponCall({
  weapon: "mine",
  call: "unknown",
  confidence: "low",
  ambiguity: "none",
});
assert(unknownClear.raw < 0, "unknown on a diagnostic cable should cost something");

const wrongHigh = scoreWeaponCall({ weapon: "mine", call: "missile", confidence: "high", ambiguity: "none" });
const wrongLow = scoreWeaponCall({ weapon: "mine", call: "missile", confidence: "low", ambiguity: "none" });
assert(wrongHigh.raw < wrongLow.raw, "a confident wrong call should cost more than a hesitant one");
assert(wrongLow.raw < 0, "a wrong call should be negative");

const rightHigh = scoreWeaponCall({ weapon: "drone", call: "drone", confidence: "high", ambiguity: "none" });
const rightLow = scoreWeaponCall({ weapon: "drone", call: "drone", confidence: "low", ambiguity: "none" });
assert(rightHigh.raw > rightLow.raw, "a confident correct call should score more");
assert(rightLow.raw > 0, "a correct call should be positive");

assert(scaleDamageScore([CONFIG.damage.scoreWrongHigh]) === 0, "worst miss scales to 0");
assert(scaleDamageScore([CONFIG.damage.scoreCorrectHigh]) === 100, "best call scales to 100");
const abstain = scaleDamageScore([CONFIG.damage.scoreUnknownAmbiguous]);
assert(abstain != null && abstain > 40 && abstain < 70, `ambiguous unknown scaled to ${abstain}`);
assert(scaleDamageScore([]) === null, "no cables means no damage score");

const decisions = Array.from({ length: CONFIG.days }, () => BASELINE);
const world = simulate("damage-wire", decisions);
for (const event of world.events) {
  if (!event.damage) continue;
  if (event.damage.weapon === "mine") {
    assert(!isAboveWaterlineOnly(event.damage.early), event.id);
    assert(!isAboveWaterlineOnly(event.damage.full), event.id);
    assert(!factsAreAboveWaterlineOnly(event.damage), event.id);
  }
  for (const report of [event.damage.early, event.damage.full]) {
    assert(!WEAPON_WORD.test(report.text), report.text);
    if (report.compartmentOnly || report.ambiguity === "height") {
      assert(report.heightOfBreach === "unknown", report.text);
      assert(report.text.toLowerCase().includes("height of breach unknown"), report.text);
    }
  }
  assert(!/\bmine contact\b/i.test(event.summary), event.summary);
  assert(!WEAPON_WORD.test(event.summary), event.summary);
}

const morning = presentMorning(world, 16);
assert(!JSON.stringify(morning).includes('"weapon"'), "morning view must not carry the hidden weapon");
for (const item of morning.damageCases) {
  assert(!WEAPON_WORD.test(item.text), item.text);
  assert(!Object.hasOwn(item, "weapon"), "public damage case leaked a weapon field");
}

const tags: Record<string, WeaponTag> = {};
for (const event of world.events) {
  if (!event.damage) continue;
  tags[event.id] = { eventId: event.id, call: event.damage.weapon, confidence: "high" };
}
const card = buildScorecard(world, decisions, {}, [], 4, tags);
assert(card.damage.rows.length > 0, "a month of sailing should show at least one damage cable");
for (const row of card.damage.rows) {
  assert(row.call === row.weapon, row.eventId);
  assert(row.raw > 0, row.note);
}
const heightRows = card.damage.rows.filter((row) => row.ambiguity === "height");
if (heightRows.length > 0) {
  const sample = heightRows[0];
  const graded = gradeDamageCalls(
    world.events,
    world.reports,
    { [sample.eventId]: { eventId: sample.eventId, call: "unknown", confidence: "high" } },
    CONFIG.days + 1,
  );
  const row = graded.rows.find((item) => item.eventId === sample.eventId);
  assert(row != null, "height-unknown hit should still be graded");
  assert(row.raw === 0, "unknown on that cable should be zero");
  assert(/not penalized/.test(row.note), row.note);
}

console.log(
  `damage checks passed (${compartmentCases} compartment-only mine cables, ${aboveOnlyReports} above-waterline-only reports, ${card.damage.rows.length} graded hits)`,
);
