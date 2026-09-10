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
 * Если Chromium качать не хочется, а в системе есть Google Chrome:
 *   PISMO_BROWSER_CHANNEL=chrome npm i playwright --ignore-scripts
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

/**
 * Поле телефона в форме входа — с маской +7 (…), и вставлять в него номер
 * целиком нельзя: "+79990001001" превратится в "+7 (799) 900-01-00".
 * Оставляем только национальную часть (10 цифр) — маска сама добавит +7.
 */
const NATIONAL_PHONE = PHONE.replace(/\D/g, "").replace(/^7/, "").slice(-10);

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

  const browser = await chromium.launch({
    channel: process.env.PISMO_BROWSER_CHANNEL || undefined,
  });
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
      // ВАЖНО: поле телефона — обычный input (не tel/password), поэтому
      // getByRole("textbox") его не находит и приходится брать по маске;
      // у поля пароля вообще нет ARIA-роли — его находим по type=password.
      await page.locator('input[placeholder^="+7"]').fill(NATIONAL_PHONE);
      await page.getByRole("button", { name: /продолжить/i }).click();
      await page.waitForTimeout(2000);
      // Полей с type=password в разметке может быть несколько (в скрытых
      // формах) — берём именно видимое.
      await page.locator("input[type=password]:visible").first().fill(PASSWORD);
      await page.getByRole("button", { name: /войти|создать/i }).click();
      await page.waitForTimeout(4000);
    });

    await page.screenshot({ path: path.join(OUT_DIR, "02-chats.png") });
    console.log("  сохранён 02-chats.png");

    // Меню «⋯» в шапке списка чатов (профиль/оформление лежат внутри него).
    const openMenu = async () => {
      await page.locator('button[title="Настройки"]').click();
      await page.waitForTimeout(400);
    };

    // Открываем первый ЖИВОЙ диалог: «Сохранённые сообщения» (это чат с самим
    // собой) для карточки не показателен.
    await safe("открыть чат", async () => {
      const row = page
        .locator("button.row-item")
        .filter({ hasNotText: /Сохранённые/ })
        .first();
      await row.click();
      await page.waitForTimeout(2500);
    });
    await page.screenshot({ path: path.join(OUT_DIR, "03-chat.png") });
    console.log("  сохранён 03-chat.png");

    // Профиль: кнопка-аватар справа в шапке списка чатов (title="Профиль").
    await safe("открыть профиль", async () => {
      await page.locator('button[title="Профиль"]').click();
      await page.waitForTimeout(2000);
    });
    await page.screenshot({ path: path.join(OUT_DIR, "04-profile.png") });
    console.log("  сохранён 04-profile.png");

    // Оформление темы (меню «⋯» списка чатов).
    await safe("открыть оформление", async () => {
      await page.keyboard.press("Escape");
      await page.waitForTimeout(900);
      await openMenu();
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
