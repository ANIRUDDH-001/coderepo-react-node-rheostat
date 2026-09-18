import { AppError } from "../../shared/errors/app-error.js";
import { assertCan } from "../../shared/auth/permissions.js";
import { ensureObjectId, sameId } from "../../shared/utils/object-id.js";
import { escapeRegex } from "../../shared/utils/keys.js";
import { auditService } from "../audit/audit.service.js";
import { personRepository } from "./person.repository.js";

export const publicPerson = (person) => ({
	_id: String(person._id),
	name: person.name,
	email: person.email,
	avatarColor: person.avatarColor,
	role: person.role,
	headline: person.headline || "",
});

const PERSON_NOT_FOUND = () => new AppError(404, "PERSON_NOT_FOUND", "The requested person does not exist.");

export const personService = {
	findProfileById: (id) => personRepository.findProfileById(id),
	async listProfiles() {
		return (await personRepository.listProfiles()).map(publicPerson);
	},
	async search(query, limit = 20) {
		const expression = query ? { $regex: escapeRegex(query), $options: "i" } : null;
		return (await personRepository.search(expression, limit)).map(publicPerson);
	},
	async findMany(ids) {
		const unique = [...new Set(ids.map(String))];
		return unique.length ? (await personRepository.findByIds(unique)).map(publicPerson) : [];
	},
	async updateRole(personId, role, actor) {
		assertCan(actor, "people:manageRoles");
		ensureObjectId(personId, "PERSON_NOT_FOUND", "The requested person does not exist.");
		const person = await personRepository.findById(personId);
		if (!person || !person.isProfile) throw PERSON_NOT_FOUND();
		if (person.role === "admin" && role !== "admin" && (await personRepository.countByRole("admin")) <= 1) {
			throw new AppError(400, "LAST_ADMIN", "At least one admin must remain in the organization.");
		}
		if (sameId(person._id, actor._id) && role !== "admin") {
			throw new AppError(400, "SELF_DEMOTION", "Ask another admin to change your own role.");
		}
		const updated = await personRepository.updateRole(personId, role);
		await auditService.record({
			actor,
			action: "person.roleChanged",
			entityType: "person",
			entityId: updated._id,
			entityLabel: updated.name,
			summary: `${actor.name} changed ${updated.name}'s role from ${person.role} to ${role}.`,
			metadata: { from: person.role, to: role },
		});
		return publicPerson(updated);
	},
	// Attaches a public actor to records that carry an actorId (audit entries, versions, reviews).
	async attachActors(records, field = "actorId", target = "actor") {
		const people = await this.findMany(records.map((record) => record[field]).filter(Boolean));
		const byId = new Map(people.map((person) => [person._id, person]));
		return records.map((record) => ({ ...record, [target]: byId.get(String(record[field])) || null }));
	},
};
