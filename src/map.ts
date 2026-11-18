import { ZONE_LABEL } from "./labels";
import type { Zone } from "./types";

const ZONES: Zone[] = ["gulf", "strait", "oman", "yanbu", "bab"];

export function mapSvg(active: Zone | null): string {
  const hot = (zone: Zone, extra = "") => (active === zone ? ` class="hot"${extra}` : extra);
  return `<svg class="map" viewBox="0 0 800 520" role="img" aria-labelledby="map-title map-desc">
    <title id="map-title">Schematic of the routes in Strait</title>
    <desc id="map-desc">Not to scale. The Arabian Gulf narrows into the Strait of Hormuz and opens into the Gulf of Oman, where Fujairah sits. An inset shows Yanbu on the Red Sea and Bab al-Mandab to the south. Dashed lines are the bypass pipelines.</desc>
    <rect width="800" height="328" rx="8" fill="#e7d3ae"/>
    <path fill="#d7ebe4" d="M18 86 H292 L348 124 L418 140 L492 124 L782 100 V206 L508 246 L418 226 L338 248 L18 230 Z"/>
    <path ${hot("strait")} fill="#b7d9d0" d="M348 124 L418 140 L418 226 L338 248 L292 200 L348 150 Z" opacity="0.95"/>
    <circle cx="646" cy="214" r="7" fill="#1a4742"/>
    <text x="78" y="150" class="map-label">Arabian Gulf</text>
    <text x="78" y="172" class="map-sub">ships wait at anchor</text>
    <text x="368" y="208" class="map-label">Strait</text>
    <text x="560" y="140" class="map-label">Gulf of Oman</text>
    <text x="658" y="206" class="map-sub">Fujairah</text>
    <path d="M150 196 C 280 210, 460 180, 640 214" fill="none" stroke="#8d3b2c" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="470" y="168" class="map-sub pipe">Fujairah line</text>
    <path d="M120 220 C 120 300, 70 340, 70 400" fill="none" stroke="#8d3b2c" stroke-width="2" stroke-dasharray="5 4"/>
    <text x="128" y="300" class="map-sub pipe">East–West line</text>
    <text x="24" y="358" class="map-kicker">Inset · Red Sea bypass · not to scale</text>
    <rect x="18" y="372" width="764" height="128" rx="8" fill="#e7d3ae"/>
    <path fill="#d7ebe4" d="M40 392 H430 L470 404 L520 430 L560 470 H40 Z"/>
    <path fill="#d7ebe4" d="M560 470 H700 L760 492 H620 L560 470 Z"/>
    <text x="70" y="430" class="map-label">Yanbu</text>
    <text x="70" y="452" class="map-sub">Northbound leaves via Suez and does not pass Bab.</text>
    <text x="590" y="456" class="map-label">Bab al-Mandab</text>
    <text x="590" y="478" class="map-sub">Southbound cargo must pass.</text>
    ${ZONES.map((zone) => {
      const box = HIT[zone];
      return `<rect ${hot(zone)} data-zone="${zone}" x="${box.x}" y="${box.y}" width="${box.w}" height="${box.h}" fill="transparent" stroke="transparent" tabindex="0" role="button" aria-label="${ZONE_LABEL[zone]}"><title>${ZONE_LABEL[zone]}</title></rect>`;
    }).join("")}
  </svg>`;
}

const HIT: Record<Zone, { x: number; y: number; w: number; h: number }> = {
  gulf: { x: 18, y: 86, w: 300, h: 160 },
  strait: { x: 318, y: 120, w: 120, h: 130 },
  oman: { x: 470, y: 96, w: 312, h: 160 },
  yanbu: { x: 40, y: 392, w: 480, h: 90 },
  bab: { x: 540, y: 430, w: 220, h: 60 },
};

export const ZONE_BLURB: Record<Zone, string> = {
  gulf: "Tankers wait in the Arabian Gulf before the Strait. Waiting is much safer than sailing. It does not move the oil, and a full anchorage starts to shut loadings in.",
  strait: "The chokepoint. Escorts cover ships here, yours first, then whatever slot is left for other traffic. Sweepers reduce mine hazard in the lane over days, not in an afternoon.",
  oman: "The Fujairah pipeline bypasses the Strait and loads in the Gulf of Oman. The line has its own outage risk. Escorts here cover those loadings, not the Strait.",
  yanbu: "The East–West pipeline brings oil to Yanbu on the Red Sea. Northbound cargo goes toward Suez and does not transit Bab al-Mandab. It can still slip a day on the canal.",
  bab: "Oil that leaves Yanbu heading south must pass Bab al-Mandab. Escorts and sweepers here do nothing for the Strait. Northbound Yanbu cargo never sees this water.",
};
