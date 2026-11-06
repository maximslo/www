import { Redis } from "@upstash/redis";
import { env } from "./env";

// Server-only. Created on first use so a missing env var surfaces as a
// handled error in the request, not a crash at import time.
let redis: Redis | undefined;

export function getRedis(): Redis {
	redis ??= new Redis({
		url: env("UPSTASH_REDIS_REST_URL"),
		token: env("UPSTASH_REDIS_REST_TOKEN"),
	});
	return redis;
}
