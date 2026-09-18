import { AppError } from "../../shared/errors/app-error.js";
import { assertCan } from "../../shared/auth/permissions.js";
import { auditService } from "../audit/audit.service.js";
import { ENVIRONMENT_KEYS } from "./project.model.js";
import { projectRepository } from "./project.repository.js";

const ENVIRONMENT_DEFAULTS = {
	development: { name: "Development", color: "#0b8043", protected: false, requiredApprovals: 1 },
	staging: { name: "Staging", color: "#b85c00", protected: false, requiredApprovals: 1 },
	production: { name: "Production", color: "#c5221f", protected: true, requiredApprovals: 1 },
};

export const defaultEnvironments = () => ENVIRONMENT_KEYS.map((key) => ({ key, ...ENVIRONMENT_DEFAULTS[key] }));

export const PROJECT_NOT_FOUND = () => new AppError(404, "PROJECT_NOT_FOUND", "The requested project does not exist.");

export function environmentOf(project, environmentKey) {
	const environment = (project?.environments || []).find((candidate) => candidate.key === environmentKey);
	if (!environment) throw new AppError(404, "ENVIRONMENT_NOT_FOUND", "The requested environment does not exist.");
	return environment;
}

export function mergeEnvironmentPatches(current, patches = []) {
	const byKey = new Map(current.map((environment) => [environment.key, { ...environment }]));
	for (const patch of patches) {
		const environment = byKey.get(patch.key);
		if (!environment) throw new AppError(422, "INVALID_CONFIG", `Environment ${patch.key} does not exist in this project.`, { issues: [`Unknown environment ${patch.key}.`] });
		if (patch.name !== undefined) environment.name = patch.name;
		if (patch.color !== undefined) environment.color = patch.color;
		if (patch.protected !== undefined) environment.protected = patch.protected;
		if (patch.requiredApprovals !== undefined) environment.requiredApprovals = patch.requiredApprovals;
	}
	return ENVIRONMENT_KEYS.map((key) => byKey.get(key));
}

export const projectService = {
	list: () => projectRepository.list(),
	async getByKey(key) {
		const project = await projectRepository.findByKey(key);
		if (!project) throw PROJECT_NOT_FOUND();
		return project;
	},
	async create(input, actor) {
		assertCan(actor, "project:manage");
		const count = await projectRepository.count();
		const project = await projectRepository.create({ ...input, environments: defaultEnvironments(), sortOrder: count + 1, createdBy: actor._id });
		await auditService.record({
			actor,
			action: "project.created",
			entityType: "project",
			entityId: project._id,
			entityLabel: project.name,
			projectId: project._id,
			summary: `${actor.name} created project ${project.name}.`,
			metadata: { key: project.key },
		});
		return project;
	},
	async update(key, input, actor) {
		assertCan(actor, "project:manage");
		const project = await this.getByKey(key);
		const patch = {};
		if (input.name !== undefined) patch.name = input.name;
		if (input.description !== undefined) patch.description = input.description;
		if (input.environments) patch.environments = mergeEnvironmentPatches(project.environments, input.environments);
		const updated = await projectRepository.update(project._id, patch);
		const changedEnvironments = (input.environments || []).map((environment) => environment.key);
		await auditService.record({
			actor,
			action: "project.updated",
			entityType: "project",
			entityId: project._id,
			entityLabel: updated.name,
			projectId: project._id,
			summary: changedEnvironments.length
				? `${actor.name} updated environment policy for ${changedEnvironments.join(", ")} in ${updated.name}.`
				: `${actor.name} updated project ${updated.name}.`,
			metadata: { environments: input.environments || [], fields: Object.keys(patch) },
		});
		return updated;
	},
};
