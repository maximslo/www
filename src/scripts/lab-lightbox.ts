/**
 * Click a tile and it grows out of its place in the grid while the page behind
 * blurs, with the project's name and link underneath.
 *
 * The growth is a FLIP: the enlarged copy is placed at its final size first,
 * then transformed back onto the clicked tile's rect and animated to identity.
 * Animating the real geometry instead would relayout every frame, and starting
 * from the centre would lose the connection to the tile that was clicked.
 */

const DURATION = 680;
const EASING = "cubic-bezier(0.16, 1, 0.3, 1)";

// Locked to the media's timing and curve so the background softens exactly in
// step with the enlarge rather than trailing it.
const VEIL_DURATION = DURATION;
const VEIL_EASING = EASING;

// Closing wants to be quicker than opening — a slow dismissal feels unresponsive.
const CLOSE_SCALE = 0.7;

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

// Phones and tablets. Counter-scaling the corner radius means repainting the
// stage — a decoded video at full size — on every frame, which a mobile GPU
// feels far more than a desktop one. The mismatch it corrects is also smaller
// there, since a tile is a bigger fraction of the screen and the scale factor is
// nearer 1, so the trade goes the other way and the radius is left alone.
const compact = window.matchMedia("(max-width: 900px), (pointer: coarse)");

// Leaves room for the caption under the media and air around it.
const MAX_WIDTH = 0.86;
const MAX_HEIGHT = 0.78;

const dialog = document.querySelector<HTMLDialogElement>(".lab-lightbox");
const veil = dialog?.querySelector<HTMLElement>(".lightbox-veil");
const stage = dialog?.querySelector<HTMLElement>(".lightbox-stage");
const caption = dialog?.querySelector<HTMLElement>(".lightbox-caption");
const titleEl = dialog?.querySelector<HTMLElement>(".lightbox-title");
const actionEl = dialog?.querySelector<HTMLAnchorElement>(".lightbox-action");
const detailEl = dialog?.querySelector<HTMLElement>(".lightbox-detail");

if (dialog && veil && stage && caption && titleEl && actionEl && detailEl) {
	let origin: HTMLElement | null = null;
	// The tile's media element while it's out on loan to the stage.
	let lifted: HTMLElement | null = null;
	let closing = false;

	const root = document.documentElement;

	/**
	 * Locked from the first frame of the enlarge to the last frame of the shrink.
	 * A modal <dialog> doesn't stop the page behind it scrolling on its own.
	 */
	// iOS Safari scrolls the page on touch regardless of overflow: hidden. The CSS
	// touch-action: none covers current WebKit; this catches the versions that
	// don't honour it on the root, by refusing the move itself. Non-passive on
	// purpose — a passive listener can't cancel anything.
	const refuseTouchPan = (event: TouchEvent) => event.preventDefault();

	const lockScroll = () => {
		// Measured before overflow is hidden, while the scrollbar still exists.
		const gap = window.innerWidth - root.clientWidth;
		root.style.setProperty("--scrollbar-gap", `${gap}px`);
		root.classList.add("is-lightbox-open");
		document.addEventListener("touchmove", refuseTouchPan, { passive: false });
	};

	const unlockScroll = () => {
		root.classList.remove("is-lightbox-open");
		root.style.removeProperty("--scrollbar-gap");
		document.removeEventListener("touchmove", refuseTouchPan);
	};

	/**
	 * Every video in the grid keeps decoding while the lightbox is up — behind the
	 * blur, where none of it can be seen. That's several simultaneous decodes
	 * competing with the animation for the same GPU, which is what makes the
	 * enlarge stutter on a phone. They're frozen for the whole cycle and the ones
	 * that were actually running are resumed at the end.
	 */
	let frozen: HTMLVideoElement[] = [];

	// `except` is the one being enlarged — it keeps playing throughout, so the
	// enlarge scales a live surface that never has to be restarted.
	const freezeGrid = (except: HTMLElement) => {
		frozen = [...document.querySelectorAll<HTMLVideoElement>("video.lab-tile-media-el")].filter(
			(video) => video !== except && !video.paused,
		);
		frozen.forEach((video) => video.pause());
	};

	/**
	 * Moves a node without disturbing it. `moveBefore` is the atomic move: a
	 * <video> keeps its decoder, playback position and current frame across the
	 * move, which is the whole point — the enlarged copy is the tile's own
	 * element, not a fresh one that has to load, seek and swap in its first frame
	 * (that swap was the flash). The fallback is a synchronous remove-and-insert,
	 * which per spec also doesn't pause a media element, since it's back in the
	 * document before the pause steps get to run.
	 */
	const relocate = (node: Element, parent: Element, before: Node | null) => {
		const p = parent as Element & { moveBefore?: (n: Node, ref: Node | null) => void };
		if (typeof p.moveBefore === "function") p.moveBefore(node, before);
		else parent.insertBefore(node, before);
	};

	const thawGrid = () => {
		frozen.forEach((video) => video.play().catch(() => {}));
		frozen = [];
	};

	const setText = (el: HTMLElement, value: string | undefined) => {
		el.textContent = value ?? "";
		el.hidden = !value;
	};

	/** The media's own pixel size, which the enlarged box is fitted to. */
	const naturalSize = (el: HTMLElement) =>
		el instanceof HTMLVideoElement
			? { w: el.videoWidth || 16, h: el.videoHeight || 9 }
			: { w: (el as HTMLImageElement).naturalWidth || 16, h: (el as HTMLImageElement).naturalHeight || 9 };

	const open = (tile: HTMLElement) => {
		const media = tile.querySelector<HTMLElement>(".lab-tile-media-el");
		if (!media) return;

		origin = tile;
		// The tile empties out the instant its content lifts, so the grid doesn't
		// show the same media twice — once behind the blur and once enlarged.
		tile.classList.add("is-lifted");
		// Before measuring: locking changes the layout width where a scrollbar is
		// taking up space, and the FLIP's start rect has to be read after that.
		lockScroll();
		freezeGrid(media);

		// The tile's own element, moved rather than copied — the same decoded
		// surface keeps playing through the whole enlarge, exactly as it was in
		// the grid. A copy would be a new <video> that has to load, seek and swap
		// in its first frame, and that swap is visible wherever it lands: mid-
		// animation as a glitch, or at the end as a flash. The tile is blacked out
		// meanwhile (.is-lifted), so nothing shows through the blur where it was.
		lifted = media;
		stage.replaceChildren();
		relocate(media, stage, null);

		// A contain-fit tile carries a matte colour; the enlarged copy needs it
		// too or the letterboxed area goes transparent over the blur.
		const tileStyle = getComputedStyle(tile);
		const fit = tileStyle.getPropertyValue("--lab-tile-fit") || "cover";
		stage.style.setProperty("--lightbox-fit", fit);
		stage.style.setProperty("--lab-tile-fit", fit);
		stage.style.setProperty("--lightbox-bg", tileStyle.backgroundColor);

		setText(titleEl, tile.dataset.title);
		const href = tile.dataset.href;
		if (href) {
			actionEl.href = href;
			actionEl.textContent = tile.dataset.action || "Visit project";
			actionEl.hidden = false;
			setText(detailEl, undefined);
		} else {
			actionEl.hidden = true;
			setText(detailEl, tile.dataset.detail);
		}
		caption.hidden = !tile.dataset.title && !href && !tile.dataset.detail;

		// Size the stage to the media, capped to the viewport.
		const { w, h } = naturalSize(media);
		const capW = window.innerWidth * MAX_WIDTH;
		const capH = window.innerHeight * MAX_HEIGHT;
		const scale = Math.min(capW / w, capH / h);
		const width = Math.round(w * scale);
		const height = Math.round(h * scale);
		stage.style.width = `${width}px`;
		stage.style.height = `${height}px`;
		caption.style.setProperty("--lightbox-width", `${width}px`);

		const from = tile.getBoundingClientRect();
		dialog.showModal();
		const to = stage.getBoundingClientRect();

		// FLIP: invert to the tile's rect, then play forward to rest.
		const dx = from.left + from.width / 2 - (to.left + to.width / 2);
		const dy = from.top + from.height / 2 - (to.top + to.height / 2);
		const sx = from.width / to.width;
		const sy = from.height / to.height;

		if (reducedMotion.matches) return;

		// The close animations hold their end state with fill: forwards. Left in
		// place they'd reassert opacity 0 the moment this open's animation stops
		// filling, blanking the veil and caption while the dialog is still up.
		for (const el of [veil, caption]) {
			el.getAnimations().forEach((animation) => animation.cancel());
		}

		veil.animate([{ opacity: 0 }, { opacity: 1 }], {
			duration: VEIL_DURATION,
			easing: VEIL_EASING,
			fill: "forwards",
		});

		// A scaled corner radius renders scaled too: at sx ≈ 0.42 the stage's 12px
		// would draw as 5px while the tile it's growing out of draws a full 12px.
		// Countering it by 1/scale keeps the rendered corner constant, so the
		// stage's corners match the tile's at the frame they trade places.
		const radius = parseFloat(getComputedStyle(stage).borderTopLeftRadius) || 0;
		const from0 = { transform: `translate(${dx}px, ${dy}px) scale(${sx}, ${sy})` };
		const to0 = { transform: "translate(0, 0) scale(1, 1)" };

		if (!compact.matches) {
			Object.assign(from0, { borderRadius: `${radius / sx}px` });
			Object.assign(to0, { borderRadius: `${radius}px` });
		}

		// Promoted for the duration only. Left on permanently it would pin a
		// compositor layer per lightbox, which is its own memory cost on mobile.
		stage.style.willChange = "transform";
		const grow = stage.animate([from0, to0], { duration: DURATION, easing: EASING });
		grow.finished.then(() => (stage.style.willChange = "")).catch(() => {});

		// Held back until the media is most of the way out, so the caption arrives
		// on a settled frame rather than sliding around underneath it.
		caption.animate(
			[
				{ opacity: 0, offset: 0 },
				{ opacity: 0, offset: 0.45 },
				{ opacity: 1, offset: 1 },
			],
			{ duration: DURATION, easing: "linear", fill: "forwards" },
		);
	};

	const close = () => {
		if (closing || !dialog.open) return;
		closing = true;

		const to = origin?.getBoundingClientRect();
		const from = stage.getBoundingClientRect();

		const done = () => {
			dialog.close();
			// Home again, ahead of the tile's cover so the DOM order is as built.
			// Same atomic move as on the way out: still playing, same frame.
			if (origin && lifted) {
				relocate(lifted, origin, origin.querySelector(".lab-tile-cover"));
			}
			lifted = null;
			stage.replaceChildren();
			closing = false;
			// Refilled only once the media has finished travelling home, so the tile
			// and the stage never both show it.
			origin?.classList.remove("is-lifted");
			stage.style.willChange = "";
			// Released only here — the shrink is still running until this point.
			unlockScroll();
			thawGrid();
			// Return focus to the tile that opened it, or the tab order restarts
			// from the top of the document.
			origin?.focus({ preventScroll: true });
			origin = null;
		};

		// Only animate back if the tile is still where we left it.
		if (!to || to.width === 0 || reducedMotion.matches) return done();

		const dx = to.left + to.width / 2 - (from.left + from.width / 2);
		const dy = to.top + to.height / 2 - (from.top + from.height / 2);
		const duration = DURATION * CLOSE_SCALE;

		// Fades over the whole close, so the page sharpens as the tile lands
		// rather than the blur cutting out at the end.
		veil.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration,
			easing: VEIL_EASING,
			fill: "forwards",
		});

		// No opacity here: fading the stage out as it shrinks means it lands
		// part-transparent and then jumps to full when the tile is refilled. Kept
		// solid, the handover happens between two identical opaque frames.
		const scaleDown = to.width / from.width;
		const radius = parseFloat(getComputedStyle(stage).borderTopLeftRadius) || 0;

		const shrinkFrom = { transform: "translate(0, 0) scale(1, 1)" };
		const shrinkTo = {
			transform: `translate(${dx}px, ${dy}px) scale(${scaleDown}, ${to.height / from.height})`,
		};

		if (!compact.matches) {
			Object.assign(shrinkFrom, { borderRadius: `${radius}px` });
			Object.assign(shrinkTo, { borderRadius: `${radius / scaleDown}px` });
		}

		stage.style.willChange = "transform";
		const shrink = stage.animate([shrinkFrom, shrinkTo], { duration, easing: EASING });
		caption.animate([{ opacity: 1 }, { opacity: 0 }], {
			duration: duration * 0.4,
			fill: "forwards",
		});
		shrink.addEventListener("finish", done);
		shrink.addEventListener("cancel", done);
	};

	document.querySelectorAll<HTMLElement>("button.lab-tile-media").forEach((tile) => {
		tile.addEventListener("click", () => open(tile));
	});

	// Anywhere outside the media dismisses. The figure is pointer-events: none
	// apart from the stage and the link, so this covers the whole backdrop.
	dialog.addEventListener("click", (event) => {
		if (!(event.target instanceof HTMLElement)) return;
		if (event.target.closest(".lightbox-action")) return;
		close();
	});

	// Esc fires `cancel` on <dialog>; take it over so the close animates instead
	// of the dialog vanishing instantly.
	dialog.addEventListener("cancel", (event) => {
		event.preventDefault();
		close();
	});

	// Nothing here for scroll: it's locked for the whole cycle (see lockScroll),
	// so there's no drift for a dismiss-on-scroll to guard against.
}
