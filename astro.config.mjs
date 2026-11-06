// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
  // custom apex domain (served at the root) — no `base` needed
  site: 'https://maximslo.com',

  // Pages stay prerendered (static) by default; only routes that set
  // `export const prerender = false` (the /api/chat endpoint) run as
  // Vercel functions.
  adapter: vercel(),

  integrations: [
    sitemap({
      // 404 is an error page, not a real destination — leave it out of the
      // sitemap search engines crawl from.
      filter: (page) => !page.endsWith('/404/'),
    }),
  ],
});
