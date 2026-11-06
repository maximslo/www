// The ask-me chat is paused on the live site: it still shows in `astro dev`
// so it can keep being worked on, but production builds leave it off the page
// and /api/chat answers 404. Set this to `true` to bring it back live.
export const CHAT_LIVE = false;

export const CHAT_ENABLED = CHAT_LIVE || import.meta.env.DEV;
