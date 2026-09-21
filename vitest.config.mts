import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/*
 * Тесты лежат в `tests/` зеркалом `src/` и гоняются в голом node: ядро по
 * правилу §15 не знает ни React, ни three, и рантайма ему хватает. Файлам,
 * которым нужен DOM — разбор EPUB, санитайзер, сторы, — окружение задаётся
 * построчно: `// @vitest-environment jsdom` в шапке теста. Вёрстку (Compositor)
 * и растр так не проверить: у jsdom нет layout, и это честная граница —
 * сколько страниц в книге, знает только браузер.
 */
export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
