export const INTRO_NAME = "Maxim Slobodchikov";

export const INTRO_ROLE_LINES = ["Web Engineer and Designer"];

// Used as the <meta name="description"> and the og:/twitter: description —
// what a link preview or search result shows, not copy rendered on the page.
export const META_DESCRIPTION =
	"Maxim is a 23-year-old engineer and designer making visual things on and off the web. Previously at the New York Times and the Washington Post.";

export const INTRO_PARAGRAPHS = [
	"I craft interfaces for news.",
	"In 2024, I redesigned NYT Cooking and built the first newsroom agents creating live election maps.",
	"Before that, I taught design and algorithmic fairness at Boston University.",
];

// Any of these phrases appearing in an intro paragraph is rendered as a link.
export const INTRO_LINKS: Record<string, string> = {
	"NYT Cooking": "https://cooking.nytimes.com/",
	"Boston University": "https://www.bu.edu/cds-faculty/explore/",
};

export interface DirectoryEntry {
	label: string;
	href: string;
}

export const EXTERNAL_LINK_ARROW = "↗";

export const TEAMS_LABEL = "Teams";

export const TEAMS: DirectoryEntry[] = [
	{ label: "New York Times", href: "https://www.nytimes.com/" },
	{ label: "Washington Post", href: "https://www.washingtonpost.com/" },
	{ label: "Astro", href: "https://astro.build/" },
	{ label: "Wayfair", href: "https://www.wayfair.com/" },
	{ label: "NPR", href: "https://apps.npr.org/primary-election-results-2026/" },
];

export const LINKS_LABEL = "Links";

export const LINKS: DirectoryEntry[] = [
	{ label: "GitHub", href: "https://github.com/maximslo" },
	{ label: "LinkedIn", href: "https://www.linkedin.com/in/maximslo/" },
	// { label: "Resume", href: "/resume.pdf" },
	{ label: "X", href: "https://www.x.com/maximsloo" },
	{ label: "Email", href: "mailto:maximsloe@gmail.com" },
];
