import { AuditEntry } from "../../features/audit/audit.model.js";

// Entries are prepared by the feature seeders (flags, segments, …) so the history matches the data exactly.
export async function seedAudit(entries) {
	console.log("\nSeeding audit history...");
	const sorted = [...entries].sort((left, right) => left.at - right.at);
	const created = await AuditEntry.insertMany(sorted);
	console.log(`  Created ${created.length} audit entries`);
	return created;
}

export const segmentAuditEntries = (segments, projects) =>
	segments.segments.map((segment) => ({
		projectId: segment.projectId,
		actorId: segment.createdBy,
		action: "segment.created",
		entityType: "segment",
		entityId: String(segment._id),
		entityLabel: segment.key,
		summary: `Elena Novak created segment ${segment.key}.`,
		metadata: { key: segment.key, project: projects.projects.find((project) => project._id.equals(segment.projectId)).key },
		at: segment.createdAt,
	}));

export const projectAuditEntries = (projects, people) => {
	const admin = people.byEmail.get("priya.raman@rheostat.team");
	return projects.projects.map((project) => ({
		projectId: project._id,
		actorId: admin._id,
		action: "project.created",
		entityType: "project",
		entityId: String(project._id),
		entityLabel: project.key,
		summary: `${admin.name} created project ${project.name}.`,
		metadata: { key: project.key },
		at: project.createdAt,
	}));
};
