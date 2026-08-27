/**
 * Drives the white sheet (.site-canvas) as the dark section scrolls up behind it.
 *
 * Two things animate, both written as custom properties on .site-page and read by
 * the clip-path in global.css:
 *
 *   --canvas-inset   how far the sheet's painted edges are pulled in from each side
 *   --canvas-radius  the sheet's bottom corner radius
 *
 * Progress is measured from the dark section's top edge rather than from scrollY,
 * so it stays correct no matter how tall the sheet above it is. The inset runs over
 * exactly one viewport of scroll — 0 when that edge touches the bottom of the
 * viewport, 1 when it reaches the top — and finishes flush against the thumbnail
 * rail. The radius runs against a 0.4-viewport window, so the corners are fully
 * round early and then simply travel inward with the edges.
 *
 * The two use different curves, and the difference is the point. The radius wants
 * to settle: it eases out and is done while the sheet is still most of the screen.
 * The inset must not. Its whole job is to be caught mid-narrowing on the way out,
 * so it holds wide early and is still visibly moving at the frame the sheet clears
 * the top edge — landing on the rail exactly then, and never before.
 */

const REVEAL_START = 1; // inset progress spans one viewport height
const RADIUS_SPAN = 0.4; // radius completes within the first 40% of that
const RADIUS_MAX_WIDE = 40;
const RADIUS_MAX_NARROW = 24;
const WIDE_BREAKPOINT = 768;

// Floor on how narrow the sheet may get below that breakpoint, as a share of the
// viewport. Phones have no width to spare: matching the rail costs the same ~42px
// a side it does on a desktop, which is a quarter of a 320px screen rather than a
// rounding error, and the sheet ends up looking pinched instead of inset.
const NARROW_MIN_SHEET_WIDTH = 0.88;

// A resize is only believed once it's larger than mobile browser chrome moving:
// retracting a URL bar changes innerHeight by ~60–110px mid-scroll, and taking
// that at face value would re-scale progress on every frame of the scroll that
// caused it, which reads as the sheet twitching.
const IGNORED_WIDTH_DELTA = 24;
const IGNORED_HEIGHT_DELTA = 160;

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

// Eased at both ends — nothing snaps on at the first pixel of scroll, nothing
// stops abruptly. Used for the radius, which is meant to arrive and settle.
const smoothstep = (t: number) => t * t * (3 - 2 * t);

// Same soft start, but full speed at t = 1 instead of stalling into it (the
// derivative is 0 at the start and 1 at the end). Used for the inset: smoothstep's
// flat tail put it within 1% of its final width while 40px of sheet was still on
// screen, so the narrowing read as finished well before the sheet had left. This
// keeps a visible amount of travel in the last stretch.
const softStartLinearFinish = (t: number) => t * t * (2 - t);

// The clip edge is a hard boundary between white and near-black; leaving it on a
// fractional pixel makes it shimmer as it moves. Snap to the device grid instead.
const snapToDevicePixel = (value: number) => {
	const ratio = window.devicePixelRatio || 1;
	return Math.round(value * ratio) / ratio;
};

const page = document.querySelector<HTMLElement>(".site-page");
const reveal = document.querySelector<HTMLElement>(".lab-section");
const rail = document.querySelector<HTMLElement>(".lab-grid");

// 404 renders the sheet with nothing below it — there's nothing to reveal.
if (page && reveal && rail) {
	const viewport = { width: window.innerWidth, height: window.innerHeight };

	const stableViewportHeight = () => {
		const widthDelta = Math.abs(window.innerWidth - viewport.width);
		const heightDelta = Math.abs(window.innerHeight - viewport.height);

		if (widthDelta > IGNORED_WIDTH_DELTA || heightDelta > IGNORED_HEIGHT_DELTA) {
			viewport.width = window.innerWidth;
			viewport.height = window.innerHeight;
		}

		return viewport.height;
	};

	// Measured from the rail itself rather than recomputed from --lab-rail and the
	// section's padding: the sheet then lands on the thumbnails by construction, at
	// every width, and stays correct if the rail's sizing changes in CSS alone.
	//
	// Below the breakpoint that flush landing is capped instead — under ~420px the
	// floor above binds and the sheet stops a little wider than the thumbnails, on
	// purpose. Above ~420px the rail is the narrower of the two and nothing changes.
	const maxInset = () => {
		const width = window.innerWidth;
		const toRail = Math.max((width - rail.getBoundingClientRect().width) / 2, 0);

		if (width >= WIDE_BREAKPOINT) return toRail;

		return Math.min(toRail, (width * (1 - NARROW_MIN_SHEET_WIDTH)) / 2);
	};

	const maxRadius = () =>
		window.innerWidth >= WIDE_BREAKPOINT ? RADIUS_MAX_WIDE : RADIUS_MAX_NARROW;

	// Setting a custom property invalidates style for the subtree whether or not the
	// value differs, so hold the last one written and skip identical frames.
	const written = { inset: "", radius: "" };

	const write = (key: keyof typeof written, property: string, value: string) => {
		if (written[key] === value) return;
		written[key] = value;
		page.style.setProperty(property, value);
	};

	let frame = 0;

	const update = () => {
		frame = 0;

		const edge = reveal.getBoundingClientRect().top;
		const height = stableViewportHeight();

		const insetProgress = softStartLinearFinish(
			clamp((height - edge) / (height * REVEAL_START), 0, 1),
		);
		const radiusProgress = smoothstep(clamp((height - edge) / (height * RADIUS_SPAN), 0, 1));

		write("inset", "--canvas-inset", `${snapToDevicePixel(insetProgress * maxInset())}px`);
		write("radius", "--canvas-radius", `${snapToDevicePixel(radiusProgress * maxRadius())}px`);
	};

	const schedule = () => {
		frame ||= window.requestAnimationFrame(update);
	};

	update();

	window.addEventListener("scroll", schedule, { passive: true });
	window.addEventListener("resize", schedule);
	window.visualViewport?.addEventListener("resize", schedule);

	// The rail's width decides the sheet's final inset, so anything that reflows it
	// has to re-run the maths even without a window resize.
	new ResizeObserver(schedule).observe(rail);

	/**
	 * Browser chrome and overscroll follow whichever surface fills the viewport, so
	 * a rubber-band bounce at the bottom of the dark section doesn't flash white.
	 */
	const root = document.documentElement;
	const themeColor = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
	const pageThemeColor = themeColor?.content;
	let surface: string | undefined;

	const applySurface = (next: string) => {
		if (surface === next) return;
		surface = next;
		root.dataset.siteSurface = next;

		if (themeColor && pageThemeColor !== undefined) {
			themeColor.content = next === "reveal" ? "#050505" : pageThemeColor;
		}
	};

	let surfaceFrame = 0;

	const updateSurface = () => {
		surfaceFrame = 0;

		const height = window.visualViewport?.height || window.innerHeight;
		const rect = reveal.getBoundingClientRect();
		const scroller = document.scrollingElement || root;
		const maxScroll = Math.max(scroller.scrollHeight - height, 0);
		const atBottom = window.scrollY >= maxScroll - 2;

		// Narrow viewports switch only once the section has reached the top of the
		// screen — on a phone the chrome sits against that edge, so matching it any
		// earlier would recolour the bar while the white sheet still fills the view.
		const covered =
			window.innerWidth < WIDE_BREAKPOINT ? rect.top <= 0 : rect.top < height && rect.bottom > 0;

		applySurface(covered || atBottom ? "reveal" : "page");
	};

	const scheduleSurface = () => {
		surfaceFrame ||= window.requestAnimationFrame(updateSurface);
	};

	updateSurface();

	window.addEventListener("scroll", scheduleSurface, { passive: true });
	window.addEventListener("resize", scheduleSurface);
	window.visualViewport?.addEventListener("resize", scheduleSurface);
}
