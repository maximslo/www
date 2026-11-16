export const CHAT_MESSAGE_EVENT = "chat_message";
export const PROJECT_OPEN_EVENT = "project_open";
export const PROJECT_VISIT_EVENT = "project_visit";

type PlausibleWindow = Window & {
	plausible?: (eventName: string, options?: { props: Record<string, string> }) => void;
};

/** Plausible custom event. A no-op until the script has loaded, or if an ad blocker stopped it. */
export function trackEvent(eventName: string, props?: Record<string, string>) {
	(window as PlausibleWindow).plausible?.(eventName, props && { props });
}
