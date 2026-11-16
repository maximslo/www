// What visitors see when the chat can't answer normally (limits, errors,
// refusals). Written in my voice, napping included. Texts are separated by
// blank lines, which the chat splits into separate bubbles. No imports, so
// the browser can use it as well as the server.
export const CONTACT_EMAIL = "maximsloe@gmail.com";

export const BAD_REQUEST_MESSAGE = "hm that request looked off to me\n\ntry again";
export const EMPTY_MESSAGE = "you gotta say something first";
export const tooLongMessage = (maxCharacters: number) =>
	`thats a lot to read before a nap\n\nkeep it under ${maxCharacters} characters please`;

export const NOT_CONFIGURED_MESSAGE = `im out cold right now\n\nemail me at ${CONTACT_EMAIL}`;
export const RATE_LIMITED_MESSAGE = "whoa slow down\n\nim taking a quick nap\n\ntry again in a few minutes";
export const SESSION_LIMIT_MESSAGE = `im getting sleepy, gonna go nap\n\nchat later\n\n${CONTACT_EMAIL}`;
export const SERVER_ERROR_MESSAGE = `oops i fell asleep at the keyboard\n\nemail me at ${CONTACT_EMAIL}`;
export const REFUSAL_MESSAGE = `im gonna sit that one out\n\nask me about my work or email me at ${CONTACT_EMAIL}`;

export const NETWORK_ERROR_MESSAGE = "looks like the wifi is napping\n\ncheck your connection";
export const GENERIC_ERROR_MESSAGE = "i zoned out for a sec\n\ntry again in a bit";
