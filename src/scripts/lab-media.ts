/**
 * Loading behaviour for the lab grid, in two halves.
 *
 * The reveal is v3/v4's: each tile carries a solid colour card over its media
 * (.lab-tile-cover) which fades out once the asset has actually decoded a frame
 * — not on a timer, and not on `load` alone, so a slow connection holds the
 * card rather than showing a blank tile.
 *
 * The loading is new. Those versions had a handful of thumbnails and let every
 * video autoplay; this grid has a dozen tiles most of which are a full screen or
 * more below the fold, and starting them all at once costs a burst of requests
 * and a decoder per clip. Videos are declared `preload="none"` with their source
 * in `data-src`, and only get wired up as they approach the viewport.
 */

// Enough margin to start fetching before the tile is actually on screen, so the
// card is usually already fading by the time it arrives.
const ROOT_MARGIN = "600px";

// A tile that's been scrolled well past can release its decoder; the poster
// stays, so pausing is invisible.
const PLAY_MARGIN = "200px";

const reveal = (cover: HTMLElement | null) => cover?.classList.add("is-loaded");

document.querySelectorAll<HTMLElement>(".lab-tile-media").forEach((tile) => {
	const media = tile.querySelector<HTMLImageElement | HTMLVideoElement>(".lab-tile-media-el");
	const cover = tile.querySelector<HTMLElement>(".lab-tile-cover");
	if (!media) return;

	if (media instanceof HTMLImageElement) {
		// `complete` covers the cached case, where the load event already fired
		// before this script ran.
		if (media.complete && media.naturalWidth > 0) reveal(cover);
		else media.addEventListener("load", () => reveal(cover), { once: true });
		return;
	}

	// readyState >= 2 is HAVE_CURRENT_DATA: a frame exists to show.
	const onReady = () => (media.readyState >= 2 ? reveal(cover) : undefined);

	media.addEventListener("loadeddata", () => reveal(cover), { once: true });

	// The poster is the clip's own first frame and a fraction of its weight, so
	// waiting for the video itself would hold a flat colour card over content
	// that's already available. Revealing on the poster shows the real frame
	// immediately, and the swap to the playing video is invisible — it's the
	// same image. <video> fires nothing for its poster, hence the proxy load.
	const poster = media.getAttribute("poster");

	if (poster) {
		const probe = new Image();
		probe.addEventListener("load", () => reveal(cover), { once: true });
		probe.src = poster;
		if (probe.complete && probe.naturalWidth > 0) reveal(cover);
	}

	// Attach the source only once the tile is near the viewport — this is what
	// keeps the below-the-fold clips off the initial load.
	const loader = new IntersectionObserver(
		(entries, self) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) continue;
				const src = media.dataset.src;
				if (src && !media.src) {
					media.src = src;
					media.load();
				}
				onReady();
				self.disconnect();
			}
		},
		{ rootMargin: ROOT_MARGIN },
	);

	loader.observe(tile);

	// Play only while visible. Kept separate from the loader above because it
	// has to keep firing after the source is attached, and on a tighter margin.
	const player = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (entry.isIntersecting) media.play().catch(() => {});
				else media.pause();
			}
		},
		{ rootMargin: PLAY_MARGIN },
	);

	player.observe(tile);
});
