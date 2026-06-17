// @ts-check
import { defineConfig } from 'astro/config';

import mdx from '@astrojs/mdx';

// https://astro.build/config
export default defineConfig({
  // custom apex domain (served at the root) — no `base` needed
  site: 'https://maximslo.com',

  integrations: [mdx()],
});