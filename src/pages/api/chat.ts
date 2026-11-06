// The only server-rendered route on the site; everything else is prerendered.
import type { APIRoute } from "astro";
import { CHAT_ENABLED } from "../../config/chat";
import { POST as chat } from "../../chat/handler";

export const prerender = false;

// While the chat is paused (src/config/chat.ts), the endpoint is gone too.
export const POST: APIRoute = (context) =>
	CHAT_ENABLED ? chat(context) : new Response("Not found", { status: 404 });
