export interface LinkSegment {
	text: string;
	href?: string;
}

const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

function escapeForRegExp(value: string): string {
	return value.replace(REGEXP_SPECIAL_CHARACTERS, "\\$&");
}

/**
 * Splits prose into plain and linked runs by matching phrases against a map of
 * phrase → URL, so copy stays readable prose instead of being pre-chopped into
 * markup fragments.
 */
export function toLinkSegments(text: string, links: Record<string, string>): LinkSegment[] {
	const phrases = Object.keys(links);
	if (phrases.length === 0) return [{ text }];

	const phrasePattern = new RegExp(`(${phrases.map(escapeForRegExp).join("|")})`);

	return text
		.split(phrasePattern)
		.filter((segment) => segment.length > 0)
		.map((segment) => ({ text: segment, href: links[segment] }));
}
