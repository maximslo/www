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
    // Either a plain description ("Solo", "2 Designers") or a list of names —
    // the latter renders stacked on the project page, like skills. A name can
    // also be an object with an href, which renders as a link (e.g. linking
    // out to a team's own page).
    team: z.union([
      z.string(),
      z.array(z.union([z.string(), z.object({ name: z.string(), href: z.string().url() })])),
    ]),
    skills: z.array(z.string()),
    // Optional looping video thumbnail (path under /public) — replaces the gradient tile
    video: z.string().optional(),
    // Optional static image thumbnail (path under /public) — used when there's no video
    image: z.string().optional(),
    // Optional override for the homepage card only — falls back to video/image
    thumbImage: z.string().optional(),
    // Optional thumbnail aspect ratio, e.g. "16 / 9" or "4 / 3" (falls back to a cycling default)
    ratio: z.string().optional(),
    // Optional object-fit override for the hero media, e.g. "contain" (default "cover")
    fit: z.enum(['cover', 'contain']).optional(),
    // Optional zoom multiplier for the hero media (CSS scale)
    zoom: z.number().optional(),
    // Optional letterbox color behind a contain-fit hero, sampled from the image's own background
    matte: z.string().optional(),
    // Optional loading-placeholder color for the hero media — same pale pastel
    // used behind this project's homepage thumbnail, so the hero frame matches
    // it while the video/image loads (see index.astro's hardcoded `bg`)
    bg: z.string().optional(),
    // Optional object-position override for the hero media, e.g. "50% 15%"
    position: z.string().optional(),
    // Optional px to crop off the top+bottom of the thumbnail media (e.g. to hide letterboxing)
    cropY: z.number().optional(),
    // Optional px to crop off just the top (overrides cropY's top side)
    cropTop: z.number().optional(),
    // Optional px to crop off just the bottom (overrides cropY's bottom side)
    cropBottom: z.number().optional(),
    // When true, the hero is the scripted <Terminal /> demo instead of a
    // video/image. It has to be a flag read by [slug].astro rather than
    // something the MDX body places, because the hero sits above the meta row
    // and MDX content only reaches the .prose column below it.
    heroTerminal: z.boolean().optional(),
    // Optional pair id — projects sharing a value render side-by-side as two small tiles
    pair: z.string().optional(),
    // Optional external link — when set, the homepage links out instead of to /projects/<slug>
    href: z.string().url().optional(),
    // When true, hides the project from the homepage grid without deleting it
    draft: z.boolean().optional(),
  }),
});

export const collections = { projects };
