import { AppError } from "../../shared/errors/app-error.js";
import { assertCan } from "../../shared/auth/permissions.js";
import { ensureObjectId, sameId } from "../../shared/utils/object-id.js";
import { savedViewRepository } from "./saved-view.repository.js";

const NOT_FOUND = () => new AppError(404, "SAVED_VIEW_NOT_FOUND", "The requested saved view does not exist.");
const DEFAULTS = { stale: "any", state: "any", sort: "updated" };

// Views are personal: only the owner can read, rename, or delete one, whatever their role.
export function assertOwner(view, profile) {
	if (!sameId(view.ownerId, profile._id)) throw new AppError(403, "FORBIDDEN", "Saved views belong to the person who created them.");
}

// Stores only what differs from the flags list defaults so a view stays meaningful if defaults change.
export function normalizeFilters(input = {}) {
	const filters = {};
	const text = (value) => (typeof value === "string" ? value.trim() : "");
	if (text(input.query)) filters.query = text(input.query);
	if (text(input.environment)) {
		filters.environment = text(input.environment);
		if (text(input.state) && input.state !== DEFAULTS.state) filters.state = text(input.state);
	}
	if (Array.isArray(input.tags)) {
		const tags = [...new Set(input.tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean))].sort();
		if (tags.length) filters.tags = tags;
	}
	if (text(input.type)) filters.type = text(input.type);
	if (text(input.lifecycle)) filters.lifecycle = text(input.lifecycle);
	if (text(input.stale) && input.stale !== DEFAULTS.stale) filters.stale = text(input.stale);
	if (text(input.ownerId)) filters.ownerId = text(input.ownerId);
	if (input.archived === true) filters.archived = true;
	return filters;
}

async function load(id, profile) {
	ensureObjectId(id, "SAVED_VIEW_NOT_FOUND", "The requested saved view does not exist.");
	const view = await savedViewRepository.findById(id);
	if (!view) throw NOT_FOUND();
	assertOwner(view, profile);
	return view;
}

export const savedViewService = {
	list(project, profile) {
		assertCan(profile, "savedView:manageOwn");
		return savedViewRepository.findByOwner(profile._id, project._id);
	},
	create(project, input, profile) {
		assertCan(profile, "savedView:manageOwn");
		return savedViewRepository.create({
			ownerId: profile._id,
			projectId: project._id,
			name: input.name,
			filters: normalizeFilters(input.filters),
			sort: input.sort || DEFAULTS.sort,
		});
	},
	async update(id, input, profile) {
		assertCan(profile, "savedView:manageOwn");
		const view = await load(id, profile);
		const patch = {};
		if (input.name !== undefined) patch.name = input.name;
		if (input.filters !== undefined) patch.filters = normalizeFilters(input.filters);
		if (input.sort !== undefined) patch.sort = input.sort;
		return savedViewRepository.update(view._id, patch);
	},
	async remove(id, profile) {
		assertCan(profile, "savedView:manageOwn");
		const view = await load(id, profile);
		await savedViewRepository.remove(view._id);
	},
};
