const baseUrl = import.meta.env.VITE_API_URL || "/api/v1";
const SESSION_KEY = "rheostat-session-token";
const PROFILE_KEY = "rheostat-profile-token";
export const PROFILE_ID_KEY = "rheostat-profile-id";
export const SESSION_EXPIRED_EVENT = "rheostat-session-expired";

let sessionToken = localStorage.getItem(SESSION_KEY) || "";
let profileToken = localStorage.getItem(PROFILE_KEY) || "";

export function setSessionToken(token) {
	sessionToken = token || "";
	if (sessionToken) localStorage.setItem(SESSION_KEY, sessionToken);
	else localStorage.removeItem(SESSION_KEY);
}

export function setProfileToken(token) {
	profileToken = token || "";
	if (profileToken) localStorage.setItem(PROFILE_KEY, profileToken);
	else localStorage.removeItem(PROFILE_KEY);
}

export const hasSessionToken = () => Boolean(sessionToken || profileToken);
export const hasProfileToken = () => Boolean(profileToken);

export class ApiError extends Error {
	constructor(status, code, message, details) {
		super(message);
		this.status = status;
		this.code = code;
		this.details = details;
	}
}

export async function request(path, options = {}) {
	const response = await fetch(`${baseUrl}${path}`, {
		...options,
		headers: {
			"Content-Type": "application/json",
			...(profileToken || sessionToken ? { Authorization: `Bearer ${profileToken || sessionToken}` } : {}),
			...options.headers,
		},
	});
	if (response.status === 204) return null;
	const contentType = response.headers?.get?.("content-type") || "";
	const payload = contentType.includes("application/json") || !response.headers ? await response.json() : null;
	if (!response.ok) {
		const code = payload?.error?.code;
		const message = payload?.error?.message || `Rheostat service returned ${response.status}.`;
		if (response.status === 401 && ["AUTH_REQUIRED", "INVALID_TOKEN", "ACCOUNT_UNAVAILABLE"].includes(code)) {
			setProfileToken("");
			setSessionToken("");
			localStorage.removeItem(PROFILE_ID_KEY);
			window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT, { detail: message }));
		}
		throw new ApiError(response.status, code, message, payload?.error?.details);
	}
	if (!payload || !("data" in payload)) throw new ApiError(response.status, "INVALID_RESPONSE", "Rheostat service returned an invalid response.");
	return payload.data;
}
