import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";

const base = process.env.VISUAL_QA_URL ?? "http://127.0.0.1:3000";
const folder = "test-results/collection-planner-visual";
await mkdir(folder, { recursive: true });

const place = (id, name, latitude, longitude) => ({
  id, name, latitude, longitude,
  kind: "cafe", description: "Synthetic fixture for browser QA",
  distanceKm: 1, priceLabel: "$", averageForTwo: "180000",
  publicRating: 4.5, match: 90, communityNote: "",
  openUntil: "23:00", bestTime: "evening", noise: "Vừa", crowd: "Vừa",
  tags: [], scenarios: ["date", "coffee"], note: "", accent: "#6387c2",
  source: "personal", costSource: "user"
});
const places = [
  place("qa-cafe-one", "QA Cafe One", 21.0285, 105.8542),
  place("qa-cafe-two", "QA Cafe Two", 21.0300, 105.8530)
];

function snapshot(empty, orphan) {
  return {
    version: 3, customPlaces: places, savedIds: places.map(p => p.id),
    ratings: {}, recommendationFeedbacks: {}, visits: [], dailyDiscoveries: [],
    completedPlans: [], collections: [{
      id: "qa-collection", name: "QA Saved Places",
      description: "Collection-only planner browser smoke",
      placeIds: orphan ? ["deleted-place-id"] : empty ? [] : places.map(p => p.id),
      createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z"
    }]
  };
}

const browser = await chromium.launch({ headless: true });
const assertions = [];
async function runCase(label, width, height, empty, orphan = false, staleWeather = false, changeInputs = false) {
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: 1,
    reducedMotion: "reduce"
  });
  const page = await context.newPage();
  const apiCalls = [];
  const pageErrors = [];
  page.on("pageerror", error => pageErrors.push(error.message));
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    apiCalls.push(path);
    if ((staleWeather || changeInputs) && path === "/api/context/weather") {
      await new Promise(resolve => setTimeout(resolve, 1400));
    }
    const result = path === "/api/personal" ? snapshot(empty, orphan)
      : path === "/api/personal/active-plan" ? { activePlan: null }
      : path === "/api/personal/itinerary-shares" ? { shares: [] }
      : path === "/api/personal/planner-metrics" ? { metrics: null }
      : path === "/api/personal/place-covers" ? { covers: {} }
      : path.endsWith("/media") ? { userPhotos: [], google: null, googleConfigured: false }
      : path === "/api/context/weather" ? { weather: null }
      : path === "/api/routing/matrix" ? { matrix: null }
      : path === "/api/poi/discover" ? { results: [], nextOffset: null }
      : path === "/api/personal/viewport" ? { places: [], nextOffset: null }
      : { results: [], places: [], metrics: null };
    await route.fulfill({
      status: 200, contentType: "application/json",
      body: JSON.stringify(result)
    });
  });
  try {
    const response = await page.goto(base, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response?.ok()) throw new Error(`${label}: route responded ${response?.status()}`);
    const navigation = width <= 760 ? ".mobile-bottom-nav" : ".rail-nav";
    const collectionsNav = page.locator(`${navigation} button`)
      .filter({ hasText: "Bộ sưu tập" }).first();
    await collectionsNav.waitFor({ state: "visible", timeout: 30000 });
    await collectionsNav.click({ timeout: 10000 });
    await page.getByRole("heading", { name: "QA Saved Places" }).waitFor({
      state: "visible", timeout: 20000
    });
    await page.screenshot({
      path: `${folder}/${label}-collection.png`,
      animations: "disabled"
    });

    const planButton = page.getByRole("button", { name: "Lên lịch trình", exact: true }).first();
    if (empty || orphan) {
      if (!(await planButton.isDisabled())) {
        throw new Error(`${label}: collection without available places must be disabled`);
      }
      assertions.push(`${label}: empty or deleted-only collection is safely blocked`);
      return;
    }
    if (await planButton.isDisabled()) {
      throw new Error(`${label}: collection of two places is unexpectedly disabled`);
    }
    await planButton.click();
    await page.getByText("Chỉ lấy địa điểm trong bộ sưu tập").waitFor({
      state: "visible", timeout: 10000
    });
    await page.getByText("Không tự thêm điểm ngoài bộ sưu tập.", { exact: false }).waitFor({
      state: "visible", timeout: 10000
    });
    await page.screenshot({
      path: `${folder}/${label}-planner-dialog.png`,
      animations: "disabled"
    });
    assertions.push(`${label}: collection planner dialog retains collection-only banner`);
    if (changeInputs) {
      const dialog = page.locator(".app-dialog--plan");
      await dialog.getByRole("button", { name: "Tạo kế hoạch", exact: true }).click();
      // A budget edit must cancel the pending old generation without
      // requiring the user to close or reopen the dialog.
      await dialog.getByLabel("Budget / 2 người").selectOption("1000000");
      await page.waitForTimeout(1700);
      if (await dialog.locator(".plan-result").count()) {
        throw new Error(`${label}: stale plan was committed after changing budget`);
      }
      if (await dialog.getByRole("button", { name: "Tạo kế hoạch", exact: true }).count() !== 1) {
        throw new Error(`${label}: previous weather loading flag remained stuck`);
      }
      assertions.push(`${label}: budget edit invalidates in-flight plan`);
    }
    if (staleWeather) {
      const dialog = page.locator(".app-dialog--plan");
      await dialog.getByRole("button", { name: "Tạo kế hoạch", exact: true }).click();
      await dialog.getByRole("button", { name: "Đóng" }).click();
      // Closing while a weather request is pending invalidates that request;
      // reopening must never receive stale plan state or a stuck loading flag.
      await planButton.click();
      await page.waitForTimeout(1700);
      if (await dialog.locator(".plan-weather-card").count()) {
        throw new Error(`${label}: stale weather response mutated reopened collection planner`);
      }
      await dialog.getByRole("button", { name: "Tạo kế hoạch", exact: true })
        .waitFor({ state: "visible", timeout: 10000 });
      assertions.push(`${label}: closing and reopening invalidates pending weather`);
    }
  } catch (error) {
    await page.screenshot({
      path: `${folder}/${label}-failure.png`, animations: "disabled"
    }).catch(() => undefined);
    console.error(`${label} API calls:`, apiCalls.join(", "));
    console.error(`${label} browser errors:`, pageErrors.join(" | "));
    throw error;
  } finally {
    await context.close();
  }
}

try {
  await runCase("desktop", 1440, 900, false);
  await runCase("mobile", 390, 844, false);
  await runCase("empty", 390, 844, true);
  await runCase("orphan", 390, 844, false, true);
  await runCase("stale-weather", 390, 844, false, false, true);
  await runCase("stale-budget", 390, 844, false, false, false, true);
  console.log("PASS collection-planner synthetic visual smoke:", assertions.join(" | "));
} finally {
  await browser.close();
}
