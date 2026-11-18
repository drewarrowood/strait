# Strait

A single-player exercise in operational judgment during a fictional 2026 shipping crisis. You play a staff officer at a trade coordination cell: escorts, convoys, mine clearance, route mix, what you tell owners, and what you are willing to say in public.

You do not choose weapons, targets, or strikes. Incidents happen to merchant ships. Your levers are exposure, routing, clearance, and the book you keep.

The grade is judgment under uncertainty. A kind random draw is not a good month. The debrief replays your exact decisions on many seeds and shows the median and the 5th–95th percentile, so you can see whether the result was the policy or the luck.

All figures are illustrative. They are not a forecast, not a measurement of any real navy or waterway, and not advice for moving a ship. Every tunable number lives in [`src/config.ts`](src/config.ts), with comments.

## How to play

A turn is one day. The campaign is 30 days, then a debrief.

Each morning you can read four things:

- **Brief.** What your own ships reported yesterday, whether a pipeline accepted what you nominated, and which contested claims arrived overnight. A quiet programme cable means your ships reported nothing. It does not mean the sea was quiet.
- **Ledger.** For each contested report: **confirm** (and say how many separate incidents you are booking), **hold**, **exclude**, or **merge** it with a programme-log entry or another report. Hold is an allowed answer. Untouched reports are abstentions.
- **Plan.** Escorts (six ships; unused ones cover nobody), convoy size, sweepers (three, and they work slowly), how many programme tankers you call toward the Strait, Fujairah and Yanbu nominations, and what share of Yanbu cargo sails south. Southbound Yanbu cargo must pass Bab al-Mandab. Northbound cargo goes via Suez and does not. Guidance changes whether owners will sail unescorted. The public line moves the illustrative price index, and a reassurance followed by damage costs you politically.
- **Forecast.** On some mornings you must give a probability before the day will commit. Flow questions resolve when the joint release prints. Questions about true incident counts stay sealed until the debrief, because that count is not in your inbox.

The plan never shows a bare point estimate. Every model outcome is a **median and a 5th–95th band**, drawn with posture still uncertain. It is not a peek at this seed.

### What the sources are for

| Source | What to expect |
| --- | --- |
| Joint centre | Slow, confirmed, and a few days behind. The weekly flow figure is a theatre average with measurement error, not your programme total. The incident bulletin leaves the latest day still in processing. |
| Trade alert | Fast, unconfirmed, sometimes filed late, sometimes in the wrong place. |
| Liaison note | Usually accurate about what that desk actually saw. Not comprehensive. |
| State-affiliated media | Often early. Often inflated. Sometimes invented. Sometimes true. |
| Press relay | Repeats other people. Watch for a running total printed as if it were today’s count. |
| Anonymous official | Sometimes an early hint, sometimes a rumor. |

### How you are scored

- **Forecasts.** Brier score and log score. Lower Brier is better. A constant 50% scores 0.25 on Brier. Skill is measured against that.
- **Ledger.** Only calls you actually make. Confirming a running total as a daily count, merging two claims that truly happened in different places, excluding the only trace of a real background incident, and booking one incident twice are wrong. Matching a duplicate to the original is right.
- **Operations.** Your decision sequence is replayed on 80 seeds and compared with a steady baseline on those same seeds. The grade uses the **mean** utility, so a fat tail of casualties counts even when the median looks acceptable. Matching the baseline is 60. Beating it moves you up.

The debrief names bookkeeping failures in plain words, including counting a running total as a daily count, shelving a probability after one quiet bulletin, merging claims from different places, and treating a missing report as proof that nothing happened. It also shows the hidden event log beside the call you made.

Sharing a seed (`Copy link`) gives someone else the same hidden month. It does not replay your decisions.

## Run it locally

```bash
npm install
npm run dev
```

Open [http://127.0.0.1:43117](http://127.0.0.1:43117).

The simulation check (many seeds, sane ranges, overdispersion, determinism, and the bookkeeping phrases):

```bash
npm test
```

With Chrome installed, `npm run smoke` plays a full month in a headless browser, opens the built `dist/index.html` from disk, and checks the debrief.

## Play on GitHub Pages

The workflow publishes the game to [https://drewarrowood.github.io/strait/](https://drewarrowood.github.io/strait/).

Pushes to `main` run `.github/workflows/pages.yml`. That workflow installs, tests, builds `dist/`, and deploys it with GitHub Pages. The build is one HTML file: script and style are inlined, and the favicon is a data URL, so nothing asks the server for `/assets/...`. Vite’s `base` is `./` for that reason. A root-absolute asset path would 404 under the `/strait/` project site, and the workflow fails the build if one appears.

Pages has to use **GitHub Actions** as its source (Settings → Pages → Build and deployment → Source). The first successful deploy is what turns the link on.

## Deploy it as a static site

```bash
npm install
npm run build
```

`dist/index.html` is a single file: script and style are inlined. Open that file in a browser, or upload `dist/` to any static host. There is no server, no account, and no build step on the host.

```bash
npm run preview
```

serves the built file at [http://127.0.0.1:43117](http://127.0.0.1:43117) if you want to check the production bundle.

A saved month lives in this browser only (`localStorage`). Clearing site data abandons it.
