#!/usr/bin/env node
/**
 * Скриншоты для карточки приложения в RuStore.
 *
 * RuStore требует не менее 3 скриншотов для телефона, форматы .png/.jpg,
 * до 3 МБ каждый, максимум 2160×3840 px, рекомендуемое соотношение 16:9.
 * Скрипт снимает 1080×1920 (9:16, т.е. 16:9 в вертикальной ориентации).
 *
 * Запуск (Playwright ставится отдельно — в проекте его нет):
 *   npm i -D playwright && npx playwright install chromium
 *   PISMO_URL=https://pismo.space PISMO_PHONE=+7XXXXXXXXXX PISMO_PASSWORD=**** \
 *     node scripts/rustore/screenshots.mjs
 *
 * Результат: docs/rustore-assets/screenshots/*.png
 */

import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
);
const OUT_DIR = path.join(ROOT, "docs", "rustore-assets", "screenshots");

const BASE_URL = process.env.PISMO_URL || "https://pismo.space";
const PHONE = process.env.PISMO_PHONE || "";
const PASSWORD = process.env.PISMO_PASSWORD || "";

/** Пропустить ожидание, не роняя скриншот при таймауте. */
async function safe(label, action) {
  try {
    await action();
    console.log(`  ok: ${label}`);
  } catch (error) {
    console.warn(`  пропуск (${label}): ${error.message}`);
  }
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    console.error(
      "Нужен Playwright: npm i -D playwright && npx playwright install chromium",
    );
    process.exit(1);
  }

  await mkdir(OUT_DIR, { recursive: true });

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1080, height: 1920 },
    deviceScaleFactor: 1,
    locale: "ru-RU",
    colorScheme: "dark",
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();

  console.log(`Открываю ${BASE_URL}`);
  await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

  // 1. Экран входа (до авторизации) — показываем всегда.
  await page.waitForTimeout(2500);
  await page.screenshot({ path: path.join(OUT_DIR, "01-login.png") });
  console.log("  сохранён 01-login.png");

  if (PHONE && PASSWORD) {
    await safe("вход по номеру и паролю", async () => {
      await page.getByRole("textbox").first().fill(PHONE);
      await page.getByRole("button", { name: /продолжить|войти/i }).click();
      await page.waitForTimeout(1500);
      await page.getByRole("textbox").first().fill(PASSWORD);
      await page.getByRole("button", { name: /войти|создать/i }).click();
      await page.waitForTimeout(4000);
    });

    await page.screenshot({ path: path.join(OUT_DIR, "02-chats.png") });
    console.log("  сохранён 02-chats.png");

    // Открываем первый чат в списке.
    await safe("открыть чат", async () => {
      await page.locator("button.row-item").first().click();
      await page.waitForTimeout(2500);
    });
    await page.screenshot({ path: path.join(OUT_DIR, "03-chat.png") });
    console.log("  сохранён 03-chat.png");

    // Профиль (пункт «⋯» → «Настройки профиля»).
    await safe("открыть профиль", async () => {
      await page.getByRole("button", { name: /настройки профиля/i }).click();
      await page.waitForTimeout(2000);
    });
    await page.screenshot({ path: path.join(OUT_DIR, "04-profile.png") });
    console.log("  сохранён 04-profile.png");

    // Оформление темы.
    await safe("открыть оформление", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(600);
      await page.getByRole("button", { name: /оформление/i }).click();
      await page.waitForTimeout(2000);
    });
    await page.screenshot({ path: path.join(OUT_DIR, "05-appearance.png") });
    console.log("  сохранён 05-appearance.png");
  } else {
    console.log(
      "PISMO_PHONE/PISMO_PASSWORD не заданы — снят только экран входа.\n" +
        "Задайте их, чтобы получить скриншоты чатов, профиля и оформления.",
    );
  }

  await browser.close();
  console.log(`\nГотово: ${OUT_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
