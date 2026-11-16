// The ask-me chat is live. Set this to `false` to pause it on the production
// site: it would still run in `astro dev` and on Vercel preview deployments
// (dev branch, PRs), but production would leave it off and /api/chat would
// answer 404.
export const CHAT_LIVE = true;

// VERCEL_ENV is Vercel's own: "production", "preview" or "development".
const IS_PREVIEW = typeof process !== "undefined" && process.env.VERCEL_ENV === "preview";

export const CHAT_ENABLED = CHAT_LIVE || import.meta.env.DEV || IS_PREVIEW;
