// The ask-me chat is paused on the live site: it still runs in `astro dev`
// and on Vercel preview deployments (dev branch, PRs) so it can keep being
// worked on and tried on a real phone, but the production deployment leaves
// it off and /api/chat answers 404. Set this to `true` to bring it back live.
export const CHAT_LIVE = false;

// VERCEL_ENV is Vercel's own: "production", "preview" or "development".
const IS_PREVIEW = typeof process !== "undefined" && process.env.VERCEL_ENV === "preview";

export const CHAT_ENABLED = CHAT_LIVE || import.meta.env.DEV || IS_PREVIEW;
