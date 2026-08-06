// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  // custom apex domain (served at the root) — no `base` needed
  site: 'https://maximslo.com',

  integrations: [mdx()],

  // Every fenced snippet on the site renders inside a dark <CodeWindow>
  // terminal frame, so token colors need to sit on a dark screen. Shiki only
  // runs one theme here — CodeWindow's `light` variant remaps these exact
  // hexes for the one snippet shown on a light card.
  markdown: {
    shikiConfig: {
      theme: 'github-dark',
    },
  },

  build: {
    // Inline the site CSS into <head> instead of linking it. Normally 10kB of
    // CSS is worth a cacheable separate file, but not here: the inlined fonts
    // sit ahead of that <link> in the byte stream, so the browser couldn't even
    // discover the stylesheet until ~28kB had arrived, and then spent another
    // round trip fetching it. Measured on 400kbps/400ms, that put first paint
    // at 2.0s — two seconds of blank page, after which everything (text, the
    // nav rule, the dotted link underlines) appeared at once and the <main>
    // fade played against nothing. Inlining makes the page a single request, so
    // markup, CSS and fonts all become live on the same byte.
    inlineStylesheets: 'always',
  },

  vite: {
    build: {
      // src/fonts/*-subset.woff2 are imported with `?url` by BaseLayout.astro
      // and must come back as data: URIs, not emitted files — the whole point
      // is that the fonts arrive inside the HTML with zero extra requests, so
      // no fallback font can ever paint. They're well over Vite's default 4kB
      // inline limit, so say so explicitly rather than raising the limit
      // globally (which would start inlining unrelated images too).
      // Returning undefined leaves every other asset on the default rules.
      assetsInlineLimit: (filePath) =>
        filePath.endsWith('-subset.woff2') ? true : undefined,
    },
  },
});