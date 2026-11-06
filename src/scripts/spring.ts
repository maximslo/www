/**
 * Spring physics for the chat's motion, without an animation library.
 *
 * springEasing() turns a spring into a CSS linear() easing plus the duration it
 * needs, for element.animate(). createSpring() is a value you step every frame,
 * for motion that follows live input (scroll speed).
 */

export type SpringOptions =
	| { duration: number; bounce: number }
	| { stiffness: number; damping: number; mass?: number };

interface Physics {
	stiffness: number;
	damping: number;
	mass: number;
}

/**
 * A { duration, bounce } spring (Framer Motion's terms) as physical constants.
 * Damping ratio is 1 - bounce; the stiffness is picked so the motion has
 * settled to within 0.1% of its target when `duration` (seconds) is up.
 */
function toPhysics(options: SpringOptions): Physics {
	if ("stiffness" in options) {
		return { stiffness: options.stiffness, damping: options.damping, mass: options.mass ?? 1 };
	}
	const ratio = Math.min(Math.max(1 - options.bounce, 0.05), 1);
	const envelope = ratio < 1 ? 1 / Math.sqrt(1 - ratio * ratio) : 1;
	const omega = Math.log(envelope / 0.001) / (ratio * options.duration);
	return { stiffness: omega * omega, damping: 2 * ratio * omega, mass: 1 };
}

const SAMPLE_MS = 1000 / 60;
const STEP_MS = 1;

const easingCache = new Map<string, { easing: string; duration: number }>();

const supportsLinear =
	typeof CSS !== "undefined" && CSS.supports("animation-timing-function", "linear(0, 1)");

/** CSS easing and duration (ms) for one spring move from 0 to 1. */
export function springEasing(options: SpringOptions): { easing: string; duration: number } {
	const key = JSON.stringify(options);
	const cached = easingCache.get(key);
	if (cached) return cached;

	const { stiffness, damping, mass } = toPhysics(options);
	let x = 0;
	let v = 0;
	let t = 0;
	const samples = [0];
	// Simulate in 1ms steps; record one sample per 60fps frame until settled.
	while (t < 4000) {
		for (let i = 0; i < SAMPLE_MS / STEP_MS; i++) {
			const a = (-stiffness * (x - 1) - damping * v) / mass;
			v += a * (STEP_MS / 1000);
			x += v * (STEP_MS / 1000);
		}
		t += SAMPLE_MS;
		samples.push(x);
		if (Math.abs(1 - x) < 0.001 && Math.abs(v) < 0.01) break;
	}
	samples[samples.length - 1] = 1;

	const result = {
		easing: supportsLinear
			? `linear(${samples.map((s) => Math.round(s * 10000) / 10000).join(", ")})`
			: "cubic-bezier(0.2, 0, 0.2, 1)",
		duration: Math.round(t),
	};
	easingCache.set(key, result);
	return result;
}

export interface Spring {
	value: number;
	velocity: number;
	target: number;
	/** Advance by `dt` seconds. */
	step(dt: number): void;
	/** Close enough to its target, and slow enough, to stop updating. */
	readonly settled: boolean;
}

export function createSpring(options: SpringOptions, initial = 0): Spring {
	const { stiffness, damping, mass } = toPhysics(options);
	return {
		value: initial,
		velocity: 0,
		target: initial,
		step(dt) {
			// Small fixed substeps keep stiff springs stable at any frame rate.
			const steps = Math.max(1, Math.ceil(dt / 0.001));
			const h = dt / steps;
			for (let i = 0; i < steps; i++) {
				const a = (-stiffness * (this.value - this.target) - damping * this.velocity) / mass;
				this.velocity += a * h;
				this.value += this.velocity * h;
			}
		},
		get settled() {
			return Math.abs(this.value - this.target) < 0.5 && Math.abs(this.velocity) < 0.5;
		},
	};
}

export const prefersReducedMotion = () =>
	typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;
