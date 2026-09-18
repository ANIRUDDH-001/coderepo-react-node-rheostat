import dotenv from "dotenv";

dotenv.config({ quiet: true });

import mongoose from "mongoose";
import { AuditEntry } from "../features/audit/audit.model.js";
import { WorkspaceAccount } from "../features/auth/workspace-account.model.js";
import { Person } from "../features/people/person.model.js";
import { Project } from "../features/projects/project.model.js";
import { loadConfig } from "../shared/config/index.js";
import { DEMO_PASSWORD, seedPeople } from "./seed/people.js";
import { seedProjects } from "./seed/projects.js";

const config = loadConfig();

// Every model that holds application data. Seeding clears all of them before inserting the baseline.
const models = [Person, WorkspaceAccount, Project, AuditEntry];

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

		const people = await seedPeople();
		await seedProjects(people);

		const counts = await Promise.all([Person.countDocuments(), WorkspaceAccount.countDocuments(), Project.countDocuments()]);

		console.log("\n========================================");
		console.log("Seeding completed successfully!");
		console.log("========================================");
		console.log("\nCollection counts:");
		console.log(`  Profiles:  ${counts[0]}`);
		console.log(`  Accounts:  ${counts[1]}`);
		console.log(`  Projects:  ${counts[2]}`);
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
