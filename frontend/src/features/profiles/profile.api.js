import { request } from "../../shared/api/client.js";

export const profileApi = {
	// Cached under "profiles" by its consumers; role changes invalidate it (people.api.js).
	list: () => request("/profiles"),
};
