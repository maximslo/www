import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ base: './src/content/projects', pattern: '**/*.{md,mdx}' }),
  schema: z.object({
    title: z.string(),
    company: z.string(),
    status: z.preprocess((val) => {
      if (typeof val !== 'string') return val;
      const canonical = ['Concept', 'Contract', 'Shipped', 'Handed off'];
      return canonical.find((c) => c.toLowerCase() === val.toLowerCase()) ?? val;
    }, z.enum(['Concept', 'Contract', 'Shipped', 'Handed off'])),
    year: z.number(),
    order: z.number(),
    role: z.string(),
    timeline: z.string(),
    team: z.string(),
    skills: z.array(z.string()),
    // Optional looping video thumbnail (path under /public) — replaces the gradient tile
    video: z.string().optional(),
    // Optional static image thumbnail (path under /public) — used when there's no video
    image: z.string().optional(),
    // Optional override for the homepage card only — falls back to video/image
    thumbImage: z.string().optional(),
    // Optional thumbnail aspect ratio, e.g. "16 / 9" or "4 / 3" (falls back to a cycling default)
    ratio: z.string().optional(),
    // Optional px to crop off the top+bottom of the thumbnail media (e.g. to hide letterboxing)
    cropY: z.number().optional(),
    // Optional px to crop off just the top (overrides cropY's top side)
    cropTop: z.number().optional(),
    // Optional px to crop off just the bottom (overrides cropY's bottom side)
    cropBottom: z.number().optional(),
    // Optional scale (<1 zooms out) applied to the homepage thumb media, revealing thumbBg at the edges
    thumbZoom: z.number().optional(),
    // Optional background color shown behind the homepage thumb media (e.g. to match zoomed-out edges)
    thumbBg: z.string().optional(),
    // Optional px to shift the homepage thumb media vertically (negative moves it up)
    thumbOffsetY: z.number().optional(),
    // Optional px to shift the homepage thumb media horizontally (negative moves it left)
    thumbOffsetX: z.number().optional(),
    // Optional pair id — projects sharing a value render side-by-side as two small tiles
    pair: z.string().optional(),
    // Optional external link — when set, the homepage links out instead of to /projects/<slug>
    href: z.string().url().optional(),
    // When true, hides the project from the homepage grid without deleting it
    draft: z.boolean().optional(),
  }),
});

export const collections = { projects };
