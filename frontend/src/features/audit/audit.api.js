import { request } from "../../shared/api/client.js";
import { stringifyQuery } from "../../shared/router/match.js";

export const auditApi = {
	list: (filters = {}) => request(`/audit${stringifyQuery(filters)}`),
};
