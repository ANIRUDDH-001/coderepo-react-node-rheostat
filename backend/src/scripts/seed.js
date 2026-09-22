import dotenv from "dotenv";

dotenv.config({ quiet: true });

import mongoose from "mongoose";
import { AuditEntry } from "../features/audit/audit.model.js";
import { WorkspaceAccount } from "../features/auth/workspace-account.model.js";
import { ChangeRequest } from "../features/change-requests/change-request.model.js";
import { AudienceMember } from "../features/evaluation/audience-member.model.js";
import { EvaluationLog } from "../features/evaluation/evaluation-log.model.js";
import { FlagVersion } from "../features/flags/flag-version.model.js";
import { Flag } from "../features/flags/flag.model.js";
import { Person } from "../features/people/person.model.js";
import { Project } from "../features/projects/project.model.js";
import { RolloutPlan } from "../features/rollouts/rollout-plan.model.js";
import { SavedView } from "../features/saved-views/saved-view.model.js";
import { Segment } from "../features/segments/segment.model.js";
import { loadConfig } from "../shared/config/index.js";
import { seedAudience } from "./seed/audience.js";
import { seedChangeRequests } from "./seed/change-requests.js";
import { projectAuditEntries, seedAudit, segmentAuditEntries } from "./seed/audit.js";
import { DEMO_TODAY } from "./seed/clock.js";
import { seedEvaluationLogs } from "./seed/evaluation-logs.js";
import { seedFlags } from "./seed/flags.js";
import { DEMO_PASSWORD, seedPeople } from "./seed/people.js";
import { seedProjects } from "./seed/projects.js";
import { seedRollouts } from "./seed/rollouts.js";
import { seedSavedViews } from "./seed/saved-views.js";
import { seedSegments } from "./seed/segments.js";

const config = loadConfig();

// Every model that holds application data. Seeding clears all of them before inserting the baseline.
const models = [
	Person,
	WorkspaceAccount,
	Project,
	Segment,
	Flag,
	FlagVersion,
	ChangeRequest,
	RolloutPlan,
	AudienceMember,
	EvaluationLog,
	SavedView,
	AuditEntry,
];

async function clearDatabase() {
	console.log("Clearing existing collections...");
	await Promise.all(models.map((model) => model.deleteMany({})));
	await Promise.all(models.map((model) => model.syncIndexes()));
}

async function seed() {
	try {
		console.log("========================================");
		console.log("Rheostat Database Seeding");
		console.log("========================================\n");

		console.log("Connecting to MongoDB...");
		await mongoose.connect(config.mongodbUri);
		console.log("Connected to MongoDB");

		await clearDatabase();

		console.log(`Demo "today" is ${DEMO_TODAY.toISOString().slice(0, 10)}`);

		const people = await seedPeople();
		const projects = await seedProjects(people);
		const segments = await seedSegments(projects, people);
		const flags = await seedFlags(projects, segments, people);
		const changeRequests = await seedChangeRequests(projects, flags, people);
		const rollouts = await seedRollouts(projects, flags, people);
		const audience = await seedAudience(projects);
		await seedEvaluationLogs(projects, flags, segments, audience);
		await seedSavedViews(projects, people);
		await seedAudit([
			...projectAuditEntries(projects, people),
			...segmentAuditEntries(segments, projects),
			...flags.audit,
			...changeRequests.audit,
			...rollouts.audit,
		]);

		const counts = await Promise.all(models.map((model) => model.countDocuments()));

		console.log("\n========================================");
		console.log("Seeding completed successfully!");
		console.log("========================================");
		console.log("\nCollection counts:");
		const labels = [
			"Profiles",
			"Accounts",
			"Projects",
			"Segments",
			"Flags",
			"Flag versions",
			"Change requests",
			"Rollout plans",
			"Audience",
			"Evaluation logs",
			"Saved views",
			"Audit entries",
		];
		labels.forEach((label, index) => console.log(`  ${`${label}:`.padEnd(17)}${counts[index]}`));
		console.log("\nDemo accounts:");
		for (const profile of people.profiles)
			console.log(`  Email: ${profile.email} | Password: ${DEMO_PASSWORD} | Role: ${profile.role}`);
		console.log("========================================\n");
	} catch (error) {
		console.error("\nSeeding failed:", error.message);
		console.error(error.stack);
		process.exit(1);
	} finally {
		await mongoose.disconnect();
		console.log("Disconnected from MongoDB");
	}
}

seed();
