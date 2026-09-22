import { invalidate } from "../../shared/api/cache.js";
import { request } from "../../shared/api/client.js";

export const peopleApi = {
	search: (search = "") => request(`/people${search ? `?search=${encodeURIComponent(search)}` : ""}`),
	updateRole: (personId, role) =>
		request(`/people/${personId}/role`, { method: "PATCH", body: JSON.stringify({ role }) }).then((result) => {
			invalidate("profiles");
			invalidate("people:");
			return result;
		}),
};
