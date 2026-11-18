import puppeteer from "puppeteer-core";
import { mkdir, writeFile } from "node:fs/promises";

const chrome = process.env.CHROME || "/usr/bin/google-chrome-stable";
const base = process.env.STRAIT_URL || "http://127.0.0.1:43117";
const outDir = process.env.SHOTS || "/tmp/strait-shots";
await mkdir(outDir, { recursive: true });

const browser = await puppeteer.launch({
  executablePath: chrome,
  headless: true,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

const failures = [];
function check(cond, message) {
  if (!cond) failures.push(message);
}

async function text(page) {
  return page.evaluate(() => document.body.innerText);
}

async function shot(page, name) {
  const path = `${outDir}/${name}.png`;
  await page.screenshot({ path, fullPage: false });
  return path;
}

const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(String(error)));
page.on("console", (msg) => {
  if (msg.type() === "error") errors.push(msg.text());
});

await page.setViewport({ width: 1280, height: 860 });
await page.goto(base, { waitUntil: "networkidle0" });
check((await text(page)).includes("Thirty days"), "start screen missing the lede");
await page.type("#seed", "SMOKE1");
await page.click("[data-action=begin]");
await page.waitForFunction(() => document.body.innerText.includes("You coordinate"));
check((await text(page)).includes("You do not"), "tutorial did not explain the role");
await page.click("[data-action=tutorial-skip]");
await page.waitForFunction(() => document.body.innerText.includes("First morning"));
check((await text(page)).includes("running total"), "day-1 coach missing the running-total warning");
check((await text(page)).includes("Arabian Gulf"), "map label missing");
await shot(page, "main-brief");

await page.click("[data-phase=plan]");
await page.waitForFunction(() => document.body.innerText.includes("Median"));
const plan = await text(page);
check(plan.includes("Median") && plan.includes("95th"), "plan is missing the percentile band");
check(plan.includes("mb/d"), "plan band missing units");
check(!/\bNaN\b/.test(plan), "plan rendered NaN");
await shot(page, "main-plan");

await page.setViewport({ width: 390, height: 844 });
await page.click("[data-phase=brief]");
await page.waitForSelector(".map");
const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
check(overflow <= 2, `mobile horizontal overflow ${overflow}px`);
await shot(page, "main-phone");
await page.setViewport({ width: 1280, height: 860 });

for (let day = 1; day <= 30; day++) {
  const disabled = await page.$eval("#commit", (button) => button.disabled);
  if (disabled) {
    await page.click("[data-phase=forecast]");
    await page.waitForSelector("[data-action=forecast-record]");
    await page.click("[data-action=forecast-record]");
  }
  await page.click("#commit");
  if (day < 30) {
    await page.waitForFunction((next) => document.body.innerText.includes(`Day ${next} of 30`), { timeout: 5000 }, day + 1);
  } else {
    await page.waitForFunction(() => document.body.innerText.includes("The month is over"), { timeout: 5000 });
  }
}

await page.click("[data-action=debrief]");
await page.waitForFunction(() => document.body.innerText.includes("Brier"), { timeout: 15000 });
const debrief = await text(page);
check(debrief.includes("5th–95th") || debrief.includes("5th"), "debrief missing percentile language");
check(debrief.includes("This seed"), "debrief missing this-seed column");
check(debrief.includes("Brier"), "debrief missing Brier score");
check(debrief.includes("Hidden log") || debrief.includes("Ledger, claim by claim"), "debrief missing the book comparison");
check(!/\bNaN\b/.test(debrief), "debrief rendered NaN");
await shot(page, "debrief");

const filePage = await browser.newPage();
const fileErrors = [];
filePage.on("pageerror", (error) => fileErrors.push(String(error)));
await filePage.goto(`file://${process.cwd()}/dist/index.html`, { waitUntil: "domcontentloaded" });
await filePage.waitForFunction(() => document.body.innerText.includes("Begin the month"));
check((await text(filePage)).includes("Begin the month"), "built index.html did not open from disk");
check(fileErrors.length === 0, `file:// errors: ${fileErrors.join(" | ")}`);

check(errors.length === 0, `page errors: ${errors.join(" | ")}`);

await browser.close();
await writeFile(`${outDir}/report.json`, JSON.stringify({ failures, errors, fileErrors }, null, 2));
if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
console.log("UI smoke passed.");
