import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const blog = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/blog" }),
	schema: z.object({
		title: z.string(),
		description: z.string().optional(),
		date: z.coerce.date(),
		draft: z.boolean().default(false),
	}),
});

// One Markdown file per project under src/content/work/. The filename (e.g.
// nyt-cooking.md) becomes the URL slug at /work/<slug>/. Edit the frontmatter
// for metadata and the body below it for the write-up — then push to deploy.
const work = defineCollection({
	loader: glob({ pattern: "**/*.{md,mdx}", base: "./src/content/work" }),
	schema: z.object({
		title: z.string(),
		date: z.coerce.date(),
		/** One-line description shown under the title and in the homepage caption. */
		lede: z.string(),
		/** Live project URL, shown as a small link under the date on the page. */
		url: z.string().url().optional(),
		/** Position in the homepage grid (low number = earlier). */
		order: z.number(),
		/** Thumbnail shown on the homepage grid. */
		media: z.discriminatedUnion("type", [
			z.object({ type: z.literal("video"), src: z.string(), poster: z.string() }),
			z.object({ type: z.literal("image"), src: z.string() }),
		]),
		links: z.array(z.object({ label: z.string(), href: z.string() })).optional(),
		/** Small tech/topic chips shown in the homepage index list. */
		tags: z.array(z.string()).optional(),
		draft: z.boolean().default(false),
		/** Keep the page reachable by URL but hide it from the homepage grid. */
		unlisted: z.boolean().default(false),
		/** Keep the grid thumbnail + page, but hide it from the index list. */
		hideFromList: z.boolean().default(false),
		/** If set, the grid thumbnail links straight here — no blog page is
		 *  generated and the project is left out of the index list. */
		external: z.string().url().optional(),
	}),
});

export const collections = { blog, work };
