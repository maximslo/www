import type { APIRoute } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";
import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";
import { CONTACT_EMAIL, SYSTEM_PROMPT } from "./system-prompt";

// POST handler for /api/chat. Wired up by src/pages/api/chat.ts, which also
// opts that route out of prerendering.

const MODEL = "claude-haiku-5-5";
const MAX_MESSAGE_CHARS = 500;
const MAX_TURNS_PER_SESSION = 20;
const HISTORY_TURNS = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Server-only secrets: process.env at runtime on Vercel, import.meta.env in `astro dev`.
function env(name: string): string {
	const value = process.env[name] ?? import.meta.env[name];
	if (!value) throw new Error(`Missing env var ${name}`);
	return value;
}

type MessageRow = {
	id: number;
	session_id: string;
	role: "user" | "assistant";
	content: string;
	created_at: string;
};

type Database = {
	public: {
		Tables: {
			messages: {
				Row: MessageRow;
				Insert: Pick<MessageRow, "session_id" | "role" | "content">;
				Update: Partial<MessageRow>;
				Relationships: [];
			};
		};
		Views: {};
		Functions: {};
		Enums: {};
		CompositeTypes: {};
	};
};

const createSupabase = () =>
	createClient<Database>(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), {
		auth: { persistSession: false },
	});

let clients:
	| { anthropic: Anthropic; supabase: ReturnType<typeof createSupabase>; ratelimit: Ratelimit }
	| undefined;

function getClients() {
	clients ??= {
		anthropic: new Anthropic({ apiKey: env("ANTHROPIC_API_KEY") }),
		supabase: createSupabase(),
		ratelimit: new Ratelimit({
			redis: new Redis({
				url: env("UPSTASH_REDIS_REST_URL"),
				token: env("UPSTASH_REDIS_REST_TOKEN"),
			}),
			limiter: Ratelimit.slidingWindow(20, "10 m"),
			prefix: "chat",
		}),
	};
	return clients;
}

const text = (body: string, status: number) =>
	new Response(body, { status, headers: { "content-type": "text/plain; charset=utf-8" } });

export const POST: APIRoute = async ({ request, clientAddress }) => {
	// Only { sessionId, message } is read. Any other field (e.g. a forged
	// `history`) is ignored: history always comes from the database.
	let sessionId: unknown;
	let message: unknown;
	try {
		({ sessionId, message } = await request.json());
	} catch {
		return text("Bad request.", 400);
	}
	if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
		return text("Bad request.", 400);
	}
	if (typeof message !== "string" || !message.trim()) {
		return text("Say something first!", 400);
	}
	const userMessage = message.trim();
	if (userMessage.length > MAX_MESSAGE_CHARS) {
		return text(`Keep it under ${MAX_MESSAGE_CHARS} characters, please.`, 400);
	}

	let services: ReturnType<typeof getClients>;
	try {
		services = getClients();
	} catch (error) {
		console.error(error);
		return text(`The chat isn't set up right now. Email me at ${CONTACT_EMAIL}.`, 503);
	}
	const { anthropic, supabase, ratelimit } = services;

	const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || clientAddress || "unknown";
	const { success } = await ratelimit.limit(ip);
	if (!success) {
		return text("Whoa, that's a lot of messages. Give it a few minutes and try again.", 429);
	}

	const { count, error: countError } = await supabase
		.from("messages")
		.select("id", { count: "exact", head: true })
		.eq("session_id", sessionId)
		.eq("role", "user");
	if (countError) {
		console.error("supabase count failed", countError);
		return text(`Something broke on my end. Email me at ${CONTACT_EMAIL}.`, 500);
	}
	if ((count ?? 0) >= MAX_TURNS_PER_SESSION) {
		return text(`That's all for this chat. If you want to keep talking, email me at ${CONTACT_EMAIL}!`, 429);
	}

	const { data: rows, error: historyError } = await supabase
		.from("messages")
		.select("role, content")
		.eq("session_id", sessionId)
		.order("created_at", { ascending: false })
		.order("id", { ascending: false })
		.limit(HISTORY_TURNS * 2);
	if (historyError) {
		console.error("supabase history failed", historyError);
		return text(`Something broke on my end. Email me at ${CONTACT_EMAIL}.`, 500);
	}

	const history: Anthropic.MessageParam[] = (rows ?? [])
		.reverse()
		.map((row) => ({ role: row.role, content: row.content }));
	// The conversation has to open with a user turn.
	while (history[0]?.role === "assistant") history.shift();

	const messages: Anthropic.MessageParam[] = [...history, { role: "user", content: userMessage }];

	const encoder = new TextEncoder();
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			let reply = "";
			try {
				const stream = anthropic.messages.stream({
					model: MODEL,
					max_tokens: 300,
					// Thinking off: at a 300-token cap it would eat the reply budget.
					thinking: { type: "disabled" },
					output_config: { effort: "low" },
					system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
					messages,
				});
				stream.on("text", (delta) => {
					reply += delta;
					controller.enqueue(encoder.encode(delta));
				});
				const final = await stream.finalMessage();

				if (final.stop_reason === "refusal") {
					const deflection = `\nI can't help with that one. Ask me about my work, or email me at ${CONTACT_EMAIL}.`;
					reply += deflection;
					controller.enqueue(encoder.encode(deflection));
				}

				console.log("chat usage", {
					input: final.usage.input_tokens,
					output: final.usage.output_tokens,
					cache_read: final.usage.cache_read_input_tokens,
					cache_write: final.usage.cache_creation_input_tokens,
					stop: final.stop_reason,
				});

				const { error: insertError } = await supabase.from("messages").insert([
					{ session_id: sessionId, role: "user", content: userMessage },
					{ session_id: sessionId, role: "assistant", content: reply.trim() || "…" },
				]);
				if (insertError) console.error("supabase insert failed", insertError);
			} catch (error) {
				console.error("chat failed", error);
				controller.enqueue(encoder.encode(`${reply ? "\n" : ""}Something broke on my end. Email me at ${CONTACT_EMAIL}.`));
			} finally {
				controller.close();
			}
		},
	});

	return new Response(body, {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"cache-control": "no-store",
			"x-content-type-options": "nosniff",
		},
	});
};
