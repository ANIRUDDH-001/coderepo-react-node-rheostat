import bcrypt from "bcryptjs";
import { WorkspaceAccount } from "../../features/auth/workspace-account.model.js";
import { Person } from "../../features/people/person.model.js";
import { avatarColorFor } from "./demo-colors.js";

export const DEMO_PASSWORD = "password123";
const PASSWORD_ROUNDS = 12;

export const peopleRows = [
	{ name: "Priya Raman", email: "priya.raman@rheostat.team", role: "admin", headline: "Platform lead", sortOrder: 1 },
	{ name: "Marcus Chen", email: "marcus.chen@rheostat.team", role: "releaseManager", headline: "Delivery engineering", sortOrder: 2 },
	{ name: "Elena Novak", email: "elena.novak@rheostat.team", role: "reviewer", headline: "Staff engineer, storefront", sortOrder: 3 },
	{ name: "Diego Alvarez", email: "diego.alvarez@rheostat.team", role: "developer", headline: "Storefront checkout", sortOrder: 4 },
	{ name: "Sam Okafor", email: "sam.okafor@rheostat.team", role: "viewer", headline: "Product manager", sortOrder: 5 },
];

export async function seedPeople() {
	console.log("\nSeeding people...");
	const profiles = await Person.create(peopleRows.map((row) => ({ ...row, avatarColor: avatarColorFor(row.email), isProfile: true })));
	console.log(`  Created ${profiles.length} profiles`);

	console.log("\nSeeding sign-in accounts...");
	const passwordHash = await bcrypt.hash(DEMO_PASSWORD, PASSWORD_ROUNDS);
	const allowedProfileIds = profiles.map((profile) => profile._id);
	const accounts = await WorkspaceAccount.create(
		profiles.map((profile) => ({ name: profile.name, email: profile.email, passwordHash, allowedProfileIds })),
	);
	console.log(`  Created ${accounts.length} accounts, each able to open any of the ${profiles.length} profiles`);

	const byEmail = new Map(profiles.map((profile) => [profile.email, profile]));
	return { profiles, accounts, byEmail };
}
