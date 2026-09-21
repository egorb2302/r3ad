import { parseHTML } from 'linkedom';
import { describe, expect, it } from 'vitest';
import { blocksFromText, clamp, collectBlocks, tidy } from '@/core/clipping/blocks';
import { LIMITS } from '@/core/clipping/types';

type Root = Parameters<typeof collectBlocks>[0];

// Тот же linkedom, что и на сервере в unfurl: ядро видит дерево, а не документ.
const bodyOf = (html: string): Root =>
  parseHTML(`<!doctype html><html><body>${html}</body></html>`).document.body as unknown as Root;

describe('текст руками', () => {
  it('абзацы — по пустым строкам, переводы строк любые', () => {
    expect(blocksFromText('One\r\n\r\nTwo\n\n\n  Three  \n')).toEqual([
      { type: 'para', text: 'One' },
      { type: 'para', text: 'Two' },
      { type: 'para', text: 'Three' },
    ]);
  });

  it('слипшаяся страница режется, а не тянется', () => {
    const [block] = blocksFromText('x'.repeat(LIMITS.blockChars * 2));
    expect('text' in block && block.text.length).toBe(LIMITS.blockChars);
    expect('text' in block && block.text.endsWith('…')).toBe(true);
  });

  it('число блоков ограничено', () => {
    const text = Array.from({ length: LIMITS.blocks + 50 }, (_, i) => `p${i}`).join('\n\n');
    expect(blocksFromText(text)).toHaveLength(LIMITS.blocks);
  });

  it('tidy схлопывает пробелы, clamp оставляет короткое как есть', () => {
    expect(tidy('  a \n\t b  ')).toBe('a b');
    expect(clamp('short', 10)).toBe('short');
    expect(clamp('a'.repeat(12), 10)).toHaveLength(10);
  });
});

describe('блоки из разметки', () => {
  it('заголовки, абзацы, списки, цитаты и код — каждому свой тип', () => {
    const blocks = collectBlocks(
      bodyOf(`
        <article>
          <h1>Title</h1>
          <p>First   paragraph.</p>
          <ul><li>one</li><li>two</li><span>not an item</span></ul>
          <ol><li>a</li></ol>
          <blockquote><p>Quoted.</p></blockquote>
          <pre>  code\n    indented  \n</pre>
        </article>`),
    );
    expect(blocks).toEqual([
      { type: 'heading', text: 'Title' },
      { type: 'para', text: 'First paragraph.' },
      { type: 'list', ordered: false, items: ['one', 'two'] },
      { type: 'list', ordered: true, items: ['a'] },
      { type: 'quote', text: 'Quoted.' },
      { type: 'code', text: '  code\n    indented' },
    ]);
  });

  it('скрипты, навигация и служебные надписи не попадают в вырезку', () => {
    const blocks = collectBlocks(
      bodyOf(`
        <nav><p>Home</p></nav>
        <script>alert(1)</script>
        <p>Body</p>
        <p>[edit]</p>
        <p>Advertisement</p>
        <p>Body</p>
        <footer><p>© nobody</p></footer>`),
    );
    // Второй «Body» подряд — след чужой вёрстки, а не повтор.
    expect(blocks).toEqual([{ type: 'para', text: 'Body' }]);
  });

  it('картинка — блок медиа, только если её взяли', () => {
    const taken: string[] = [];
    const blocks = collectBlocks(
      bodyOf(`<p><img src="a.png" alt="A"/></p><img data-src="b.png"/><img src="c.png"/>`),
      {
        image: (src, alt) => {
          if (src === 'c.png') return null;
          taken.push(`${src}|${alt}`);
          return taken.length - 1;
        },
      },
    );
    expect(taken).toEqual(['a.png|A', 'b.png|']);
    expect(blocks).toEqual([
      { type: 'media', index: 0 },
      { type: 'media', index: 1 },
    ]);
  });

  it('голый текст между блоками — тоже абзац', () => {
    expect(collectBlocks(bodyOf(`Line one<br/>Line two<div>Boxed</div>`))).toEqual([
      { type: 'para', text: 'Line one' },
      { type: 'para', text: 'Line two' },
      { type: 'para', text: 'Boxed' },
    ]);
  });
});
