// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { collectImageSrcs, extractTitle, parseHtml, sanitize } from '@/core/normalize/sanitize';

describe('санитайзер — белый список, а не чёрный', () => {
  it('стили, классы, скрипты и переходы по ссылкам не переживают чистку', () => {
    const root = parseHtml(`
      <section id="s1" class="chapter" style="color:red">
        <h1>Title</h1>
        <p class="first" style="position:fixed">Hi <a href="http://x" id="a1">link</a></p>
        <script>alert('never')</script>
        <style>p{position:fixed}</style>
        <custom-tag><b>kept</b></custom-tag>
      </section>`);
    const html = sanitize(root);

    expect(html).toContain('<div id="s1">');
    expect(html).toContain('<span id="a1">link</span>');
    expect(html).toContain('<b>kept</b>');
    expect(html).not.toContain('custom-tag');
    expect(html).not.toMatch(/class=|style=|<script|<style|alert|href=/);
  });

  it('картинка остаётся только с ресурсом и своими размерами', () => {
    const warnings: string[] = [];
    const root = parseHtml(`<p><img src="a.png" alt="A"/><img src="gone.png"/></p>`);
    const html = sanitize(root, {
      resolveImage: (src) =>
        src === 'a.png' ? { url: 'data:image/png;base64,AA', width: 10, height: 20 } : undefined,
      onWarning: (code, message) => warnings.push(`${code}:${message}`),
    });

    expect(html).toContain('<img src="data:image/png;base64,AA" alt="A" width="10" height="20">');
    expect(html).not.toContain('gone.png');
    expect(warnings).toEqual(['image-missing:Image not found in the archive: gone.png']);
  });

  it('обложка, притворившаяся вектором, становится картинкой', () => {
    const root = parseHtml(
      `<svg xmlns="http://www.w3.org/2000/svg"><image xlink:href="cover.jpg" href="cover.jpg"/></svg>`,
    );
    expect(collectImageSrcs(root)).toEqual(['cover.jpg']);
    const html = sanitize(root, { resolveImage: () => ({ url: 'data:c', width: 1, height: 1 }) });
    expect(html).toContain('<img src="data:c"');
    expect(html).not.toContain('<svg');
  });

  it('первый заголовок — имя главы, если оглавление молчит', () => {
    expect(extractTitle(parseHtml(`<p>x</p><h2>  Chapter\n One </h2><h1>Later</h1>`))).toBe('Chapter One');
    expect(extractTitle(parseHtml(`<p>no headings</p>`))).toBeNull();
  });
});
