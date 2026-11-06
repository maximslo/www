// Server-only secrets: process.env at runtime on Vercel, import.meta.env in
// `astro dev` (Vite loads .env there but doesn't put it on process.env).
export function env(name: string): string {
	const value = process.env[name] ?? import.meta.env[name];
	if (!value) throw new Error(`Missing env var ${name}`);
	return value;
}
