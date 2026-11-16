export const CHAT_MESSAGE_EVENT = "chat_message";
export const PROJECT_OPEN_EVENT = "project_open";
export const PROJECT_VISIT_EVENT = "project_visit";

type PlausibleWindow = Window & {
	plausible?: (eventName: string) => void;
};

/** Plausible custom event. A no-op until the script has loaded, or if an ad blocker stopped it. */
export function trackEvent(eventName: string) {
	(window as PlausibleWindow).plausible?.(eventName);
}

/**
 * The project goes in the event name, not in a property: custom properties
 * need a Plausible plan this site isn't on, while goals work on any plan.
 * Each name below still has to be added as a goal in Plausible.
 */
export const projectEventName = (event: typeof PROJECT_OPEN_EVENT | typeof PROJECT_VISIT_EVENT, project: string) =>
	`${event}: ${project}`;
