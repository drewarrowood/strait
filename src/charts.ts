import type { Band } from "./format";
import { oneDecimal, whole } from "./format";
import { quantile } from "./rng";

export function bandOf(values: readonly number[]): Band {
  return { low: quantile(values, 0.05), median: quantile(values, 0.5), high: quantile(values, 0.95) };
}

export function sparkline(values: number[], marks: Array<{ index: number; label: string }>, width = 280, height = 64): string {
  if (values.length === 0) return `<p class="quiet">No programme days yet.</p>`;
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 1);
  const span = max - min || 1;
  const step = values.length === 1 ? 0 : (width - 8) / (values.length - 1);
  const pts = values
    .map((value, index) => {
      const x = 4 + index * step;
      const y = height - 8 - ((value - min) / span) * (height - 16);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const dots = marks
    .map((mark) => {
      const value = values[mark.index];
      if (value == null) return "";
      const x = 4 + mark.index * step;
      const y = height - 8 - ((value - min) / span) * (height - 16);
      return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="3.5" fill="#8d3b2c"><title>${mark.label}</title></circle>`;
    })
    .join("");
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" role="img" aria-label="Programme Strait flow by day, in million barrels">
    <polyline points="${pts}" fill="none" stroke="#1a4742" stroke-width="2"/>
    ${dots}
  </svg>`;
}

export function histogram(series: Array<{ values: number[]; color: string; name: string }>, actual: number | null, fmt: (n: number) => string): string {
  const all = series.flatMap((item) => item.values);
  if (all.length === 0) return "";
  const min = Math.min(...all);
  const max = Math.max(...all);
  const bins = 12;
  const span = max - min || 1;
  const width = 320;
  const height = 120;
  const gap = 2;
  const group = (width - 8) / bins;
  const counts = series.map((item) => {
    const buckets = Array.from({ length: bins }, () => 0);
    for (const value of item.values) {
      const index = Math.min(bins - 1, Math.floor(((value - min) / span) * bins));
      buckets[index] += 1;
    }
    return buckets;
  });
  const peak = Math.max(1, ...counts.flat());
  let bars = "";
  for (let i = 0; i < bins; i++) {
    series.forEach((item, seriesIndex) => {
      const h = (counts[seriesIndex][i] / peak) * (height - 28);
      const w = (group - gap) / series.length;
      const x = 4 + i * group + seriesIndex * w;
      const y = height - 18 - h;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${Math.max(1, w - 1).toFixed(1)}" height="${h.toFixed(1)}" fill="${item.color}" opacity="${seriesIndex === 0 ? 0.9 : 0.45}"><title>${item.name} bin ${i + 1}: ${counts[seriesIndex][i]}</title></rect>`;
    });
  }
  let marker = "";
  if (actual != null && Number.isFinite(actual)) {
    const x = 4 + ((clamp01((actual - min) / span) * (width - 8)));
    marker = `<line x1="${x.toFixed(1)}" x2="${x.toFixed(1)}" y1="4" y2="${height - 16}" stroke="#1c1915" stroke-width="1.5"/>
      <text x="${Math.min(width - 48, x + 4).toFixed(1)}" y="12" class="chart-label">this seed ${fmt(actual)}</text>`;
  }
  const legend = series.map((item) => item.name).join(" and ");
  return `<svg class="hist" viewBox="0 0 ${width} ${height}" role="img" aria-label="Distribution of ${legend}">
    ${bars}
    ${marker}
  </svg>`;
}

export function calibrationChart(points: Array<{ p: number; y: number }>, bins: Array<{ meanP: number; frequency: number; n: number }>): string {
  const size = 220;
  const pad = 28;
  const x = (p: number) => pad + p * (size - pad - 8);
  const y = (p: number) => size - pad - p * (size - pad - 8);
  const dots = points
    .map((point, index) => {
      const jitter = ((index % 5) - 2) * 3;
      return `<circle cx="${x(point.p).toFixed(1)}" cy="${(y(point.y) + jitter).toFixed(1)}" r="4" fill="#1a4742" opacity="0.85"><title>Forecast ${Math.round(point.p * 100)}%, outcome ${point.y === 1 ? "yes" : "no"}</title></circle>`;
    })
    .join("");
  const squares = bins
    .filter((bin) => bin.n > 0)
    .map(
      (bin) =>
        `<rect x="${(x(bin.meanP) - 5).toFixed(1)}" y="${(y(bin.frequency) - 5).toFixed(1)}" width="10" height="10" fill="none" stroke="#8d3b2c" stroke-width="2"><title>Bin mean ${Math.round(bin.meanP * 100)}%, happened ${Math.round(bin.frequency * 100)}% of ${bin.n}</title></rect>`,
    )
    .join("");
  return `<svg class="cal" viewBox="0 0 ${size} ${size}" role="img" aria-label="Calibration chart. Horizontal axis is the probability you gave. Vertical axis is how often it happened.">
    <line x1="${pad}" y1="${size - pad}" x2="${size - 8}" y2="${size - pad}" stroke="#5c564c"/>
    <line x1="${pad}" y1="${pad - 8}" x2="${pad}" y2="${size - pad}" stroke="#5c564c"/>
    <line x1="${pad}" y1="${size - pad}" x2="${size - 8}" y2="${pad - 8}" stroke="#a89880" stroke-dasharray="4 3"/>
    ${dots}
    ${squares}
    <text x="${pad}" y="${size - 8}" class="chart-label">0%</text>
    <text x="${size - 36}" y="${size - 8}" class="chart-label">100%</text>
    <text x="4" y="${pad}" class="chart-label">yes</text>
  </svg>`;
}

export function postureChart(values: number[]): string {
  return sparkline(values, [], 320, 72).replace("Programme Strait flow by day, in million barrels", "Revealed adversary posture by day, from 0 to 1");
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

export function fmtMb(n: number): string {
  return oneDecimal(n);
}

export function fmtCount(n: number): string {
  return whole(n);
}
