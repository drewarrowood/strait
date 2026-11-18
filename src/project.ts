import { CONFIG } from "./config";
import type { Band } from "./format";
import { sanitizeDecision } from "./decide";
import { simulate, summarize } from "./model";
import { quantile } from "./rng";
import type { Decisions } from "./types";

export interface Projection {
  samples: number;
  horizonDays: number;
  straitFlow: Band;
  systemFlow: Band;
  damage: Band;
  casualties: Band;
  backlog: Band;
}

export interface ProjectionStart {
  backlogShips: number;
  priceIndex: number;
}

/**
 * Bands for holding a plan steady. Posture and mine hazard are drawn from the
 * prior, not from the campaign seed, so the band is not a peek at this game.
 */
export function projectPlan(
  plan: Decisions,
  start: ProjectionStart,
  samples = CONFIG.projectionSamples,
  horizon = CONFIG.projectionHorizonDays,
): Projection {
  const decision = sanitizeDecision(plan);
  const days = Array.from({ length: horizon }, () => decision);
  const strait: number[] = [];
  const system: number[] = [];
  const damage: number[] = [];
  const casualties: number[] = [];
  const backlog: number[] = [];
  for (let i = 0; i < samples; i++) {
    const world = simulate(`band-${i}`, days, {
      reports: false,
      warmup: false,
      initialBacklog: start.backlogShips,
      initialPrice: start.priceIndex,
    });
    const totals = summarize(world);
    strait.push(totals.meanStraitMb);
    system.push(totals.meanSystemMb);
    damage.push(totals.totalDamage);
    casualties.push(totals.totalCasualties);
    backlog.push(totals.endBacklog);
  }
  return {
    samples,
    horizonDays: horizon,
    straitFlow: bandOf(strait),
    systemFlow: bandOf(system),
    damage: bandOf(damage),
    casualties: bandOf(casualties),
    backlog: bandOf(backlog),
  };
}

export function bandOf(values: number[]): Band {
  return {
    low: quantile(values, 0.05),
    median: quantile(values, 0.5),
    high: quantile(values, 0.95),
  };
}
