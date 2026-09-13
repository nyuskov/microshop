/**
 * Проверка локальных ссылок в markdown: собирает `](ссылка)` из README и всех
 * `docs/*.md` и проверяет, что файл по ссылке существует. Внешние ссылки
 * (http/https), якоря (`#...`) и ссылки с якорем (`file.md#anchor`) не проверяются
 * по содержимому — только наличие файла.
 *
 * Зачем: после переезда документов (или выноса раздела README в отдельный файл)
 * ссылки тихо гниют — markdown их не валидирует.
 *
 * Запуск (из корня репозитория):
 *   node scripts/check-docs-links.mjs
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const files = ["README.md"];
for (const dir of ["docs"]) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isFile() && entry.endsWith(".md")) files.push(full);
  }
}

let broken = 0;
for (const file of files) {
  const text = readFileSync(file, "utf8");
  for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
    const link = match[1];
    if (/^(https?:|mailto:|#)/.test(link)) continue;
    const target = link.split("#")[0];
    if (!target) continue;
    if (!existsSync(path.resolve(path.dirname(file), target))) {
      console.log(`БИТАЯ: ${file} → ${link}`);
      broken++;
    }
  }
}

console.log(
  broken ? `Итого битых ссылок: ${broken}` : "Все локальные ссылки живые.",
);
process.exitCode = broken ? 1 : 0;
