// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  // custom apex domain (served at the root) — no `base` needed
  site: 'https://maximslo.com',

  integrations: [
    sitemap({
      // 404 is an error page, not a real destination — leave it out of the
      // sitemap search engines crawl from.
      filter: (page) => !page.endsWith('/404/'),
    }),
  ],
});
