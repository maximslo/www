# Portfolio architecture & image handling notes

Notes captured 2026-06-22 while rebuilding the site on the `v2` branch.
Reference points: [qusai.design](https://qusai.design) and [joyceis.online](https://joyceis.online).

## How to serve design-portfolio content

The two reference sites bracket the spectrum:

| | qusai.design | joyceis.online |
|---|---|---|
| Rendering | Next.js, server-rendered / static (content in initial HTML) | Client-rendered SPA — ships a shell with `"Loading projects…"`, then fetches in JS |
| Content | Prismic headless CMS | Fetched from an API/JSON at runtime |
| Images | Prismic CDN, `?auto=format,compress` (WebP/AVIF, resized) | No optimization |
| SEO / first paint | Strong | Weak — crawlers & link previews see an empty shell |

**Recommendation: model it on Qusai (SSG + optimized images), but skip the hosted
CMS — local MDX gives the same result with far less overhead for a solo site.**

- **SSG (Static Site Generation):** build the pages once into finished HTML so
  content is baked in (fast, SEO-friendly, good link previews). Avoid the Joyce
  "blank until JS runs" failure mode.
- **Local MDX over a hosted CMS:** keep project write-ups as Markdown files in the
  repo, version-controlled. A hosted CMS (Prismic/Sanity/etc.) only earns its
  overhead when non-devs edit content. Tradeoff: editing = edit a file + commit,
  not a web dashboard — usually a feature for a solo dev.
- **Optimized images:** never serve full-res originals; resize + modern formats
  (WebP/AVIF), explicit dimensions, lazy-load below the fold.
- **Animation = progressive enhancement:** layer it on top of already-visible
  content, never gate content behind it.
- **Hosting:** static output on a CDN-backed host.

## Key realization: `main` already implements this

`main` is **not** a different architecture from the recommendation — it already is it:

- **Astro** (SSG by default). `src/pages/work/[slug].astro` pre-renders one HTML
  page per project at build time.
- **Local MDX content collections** in `src/content/work/` (one `.mdx` per
  project) with a typed Zod schema in `src/content.config.ts`
  (`order`, `draft`, `unlisted`, `external`, `media` image/video union, etc.).
- **Deploy:** GitHub Actions → GitHub Pages at the apex domain (`CNAME`).

The real difference is **`v2` vs `main`**, not recommendation vs main:
`v2` deliberately wiped the frontend/content/assets (commit `96eedbe`) to rebuild,
keeping config, deploy, and CNAME.

## Image handling — two paths, different behavior

### Path 1: images *inside* a project write-up → ✅ fully optimized (keep doing this)

The `<Grid>` component (`src/components/Grid.astro`) pulls from `src/assets/` and
renders via `astro:assets` `<Image>`:

- Resized + WebP at build time
- 1×/2×/3× retina `widths` with correct `sizes` (downloads at displayed width)
- `quality={90}`, per-layout sizing math, build-time error on bad paths

Usage: drop the file in `src/assets/<project>/`, reference it by plain string in
the MDX body via `<Grid>`. **This is the right way — repeat it in v2.**

### Path 2: homepage thumbnails + hero media → ⚠️ raw / unoptimized

Files in `public/` are copied as-is (Astro never optimizes them):

- `public/images/project-*.jpg` (homepage thumbnails) — **raw, the one gap**
- `public/videos/project-*.mp4` (hero loops) — raw, but **correct**: `astro:assets`
  doesn't optimize video anyway; the `IntersectionObserver` autoplay-on-screen in
  `ProjectLayout.astro` is the right approach
- favicons, `og.png`, fonts, manifest — raw, correct

## Rule of thumb for v2

| What you're adding | Where | Optimized? |
|---|---|---|
| Images inside a project write-up | `src/assets/<project>/` + `<Grid>` | ✅ yes |
| Homepage thumbnail (still image) | **move to `src/assets/` + `<Image>`** | ✅ (currently ⚠️ in `public/`) |
| Hero/loop videos | `public/videos/` (raw) | n/a — correct as-is |
| Favicons, OG image, fonts, manifest | `public/` | n/a — correct as-is |

**Single upgrade for v2:** serve the homepage thumbnail *stills* through
`astro:assets` (`src/assets/` + `<Image>`) instead of dropping them raw in
`public/images/`. Videos and static files stay in `public/`.
