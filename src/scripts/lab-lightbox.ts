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
	let closing = false;

	const root = document.documentElement;

	/**
	 * Locked from the first frame of the enlarge to the last frame of the shrink.
	 * A modal <dialog> doesn't stop the page behind it scrolling on its own.
	 */
	const lockScroll = () => {
		// Measured before overflow is hidden, while the scrollbar still exists.
		const gap = window.innerWidth - root.clientWidth;
		root.style.setProperty("--scrollbar-gap", `${gap}px`);
		root.classList.add("is-lightbox-open");
	};

	const unlockScroll = () => {
		root.classList.remove("is-lightbox-open");
		root.style.removeProperty("--scrollbar-gap");
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

		// A clone, so the tile stays in the grid — the page behind is blurred but
		// still visible, and a gap where the tile was would show through it.
		const clone = media.cloneNode(true) as HTMLElement;
		clone.removeAttribute("data-src");
		if (clone instanceof HTMLVideoElement) {
			clone.src = (media as HTMLVideoElement).currentSrc || (media as HTMLVideoElement).src;
			clone.muted = true;
			clone.loop = true;
			clone.playsInline = true;
			clone.autoplay = true;
			// Pick up where the tile's copy is rather than restarting.
			clone.currentTime = (media as HTMLVideoElement).currentTime || 0;
		}
		stage.replaceChildren(clone);

		// A contain-fit tile carries a matte colour; the enlarged copy needs it
		// too or the letterboxed area goes transparent over the blur.
		const tileStyle = getComputedStyle(tile);
		stage.style.setProperty("--lightbox-fit", tileStyle.getPropertyValue("--lab-tile-fit") || "cover");
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
		// clone's corners match the tile's at the frame they trade places.
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
			stage.replaceChildren();
			closing = false;
			// Refilled only once the clone has finished travelling home, so the two
			// never overlap.
			origin?.classList.remove("is-lifted");
			stage.style.willChange = "";
			// Released only here — the shrink is still running until this point.
			unlockScroll();
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

		// No opacity here: fading the clone out as it shrinks means it lands
		// part-transparent and then jumps to full when the tile is refilled. Kept
		// solid, the swap happens between two identical opaque frames.
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
