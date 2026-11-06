// Runs every question in src/chat/test-questions.md against the chat API,
// each in a fresh session, and prints the answers for manual review.
//   node scripts/chat-eval.mjs [baseUrl]   (default http://localhost:4321)
// Note: this counts against the per-IP rate limit (20 per 10 min).
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const base = process.argv[2] ?? "http://localhost:4321";
const questions = readFileSync(new URL("../src/chat/test-questions.md", import.meta.url), "utf8")
	.split("\n")
	.filter((line) => line.startsWith("- "))
	.map((line) => line.slice(2).trim());

for (const message of questions) {
	const res = await fetch(`${base}/api/chat`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ sessionId: randomUUID(), message }),
	});
	const answer = await res.text();
	console.log(`\nQ: ${message}\nA${res.ok ? "" : ` [${res.status}]`}: ${answer}`);
	if (res.status === 429) break;
}
