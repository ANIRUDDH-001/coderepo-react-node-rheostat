import { Project } from "../../features/projects/project.model.js";
import { defaultEnvironments } from "../../features/projects/project.service.js";
import { daysAgo } from "./clock.js";

export const projectRows = [
	{ key: "storefront", name: "Storefront", description: "Web storefront, product discovery, and checkout.", sortOrder: 1 },
	{ key: "mobile", name: "Mobile app", description: "iOS and Android shopping app.", sortOrder: 2 },
];

export async function seedProjects(people) {
	console.log("\nSeeding projects...");
	const admin = people.byEmail.get("priya.raman@rheostat.team");
	const projects = await Project.create(
		projectRows.map((row, index) => ({
			...row,
			environments: defaultEnvironments(),
			createdBy: admin._id,
			createdAt: daysAgo(130 - index, 9),
			updatedAt: daysAgo(130 - index, 9),
		})),
	);
	console.log(`  Created ${projects.length} projects with ${projects[0].environments.length} environments each`);
	return { projects, byKey: new Map(projects.map((project) => [project.key, project])) };
}
