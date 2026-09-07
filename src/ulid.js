// Minimal ULID generator (Crockford base32, 26 chars).
// 10 chars timestamp (ms since epoch) + 16 chars randomness.
// Lexicographically sortable by creation time. Spec example: ws_01K7ABC123XYZ.

const ENCODING = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ENCODING_LEN = ENCODING.length;
const TIME_LEN = 10;
const RANDOM_LEN = 16;

function encodeTime(now, len) {
	let mod;
	let str = "";
	for (let i = len - 1; i >= 0; i--) {
		mod = now % ENCODING_LEN;
		str = ENCODING.charAt(mod) + str;
		now = (now - mod) / ENCODING_LEN;
	}
	return str;
}

function encodeRandom(len) {
	let str = "";
	const bytes = new Uint8Array(len);
	globalThis.crypto.getRandomValues(bytes);
	for (let i = 0; i < len; i++) {
		str += ENCODING.charAt(bytes[i] % ENCODING_LEN);
	}
	return str;
}

export function ulid() {
	return encodeTime(Date.now(), TIME_LEN) + encodeRandom(RANDOM_LEN);
}

export function workspaceId() {
	return "ws_" + ulid();
}