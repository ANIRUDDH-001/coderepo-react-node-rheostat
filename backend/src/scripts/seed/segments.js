import { Segment } from "../../features/segments/segment.model.js";
import { daysAgo, isoDate } from "./clock.js";

const clause = (attribute, operator, values, negate = false) => ({ attribute, operator, values: values.map(String), negate });
const rule = (id, description, ...clauses) => ({ id, description, clauses });

// Eight reusable audiences: five for the storefront, three for the mobile app.
export const segmentRows = [
	{
		project: "storefront",
		key: "beta-testers",
		name: "Beta testers",
		description: "Customers who opted into early access from their account settings.",
		rules: [rule("sr_beta", "Opted into beta", clause("betaOptIn", "in", [true]))],
		includedKeys: ["qa-account-1", "qa-account-2"],
		excludedKeys: [],
	},
	{
		project: "storefront",
		key: "enterprise-plans",
		name: "Enterprise plans",
		description: "Accounts on an enterprise contract.",
		rules: [rule("sr_enterprise", "Enterprise plan", clause("plan", "in", ["enterprise"]))],
		includedKeys: [],
		excludedKeys: [],
	},
	{
		project: "storefront",
		key: "eu-users",
		name: "EU users",
		description: "Shoppers in European Union countries.",
		rules: [rule("sr_eu", "EU country codes", clause("country", "in", ["DE", "FR", "NL", "ES", "IT", "SE", "IE", "PL"]))],
		includedKeys: [],
		excludedKeys: [],
	},
	{
		project: "storefront",
		key: "internal-staff",
		name: "Internal staff",
		description: "Rheostat employees dogfooding the storefront.",
		rules: [rule("sr_staff", "Company is Rheostat", clause("company", "in", ["Rheostat"]))],
		includedKeys: ["staff-priya", "staff-marcus"],
		excludedKeys: [],
	},
	{
		project: "storefront",
		key: "high-value",
		name: "High-value customers",
		description: "Paid plans that signed up more than a year ago.",
		rules: [
			rule(
				"sr_high_value",
				"Paid and established",
				clause("plan", "in", ["pro", "enterprise"]),
				clause("signupDate", "before", [isoDate(daysAgo(365))]),
			),
		],
		includedKeys: [],
		excludedKeys: [],
	},
	{
		project: "mobile",
		key: "ios-latest",
		name: "iOS on the latest major",
		description: "iPhone and iPad users on the 6.x release line.",
		rules: [rule("sr_ios_latest", "iOS 6.x", clause("platform", "in", ["ios"]), clause("appVersion", "startsWith", ["6."]))],
		includedKeys: [],
		excludedKeys: [],
	},
	{
		project: "mobile",
		key: "android-beta",
		name: "Android beta channel",
		description: "Android users enrolled in the Play Store beta track.",
		rules: [rule("sr_android_beta", "Android beta", clause("platform", "in", ["android"]), clause("betaOptIn", "in", [true]))],
		includedKeys: [],
		excludedKeys: [],
	},
	{
		project: "mobile",
		key: "new-signups",
		name: "New sign-ups",
		description: "Accounts created in the last 45 days.",
		rules: [rule("sr_new_signups", "Signed up recently", clause("signupDate", "after", [isoDate(daysAgo(45))]))],
		includedKeys: [],
		excludedKeys: [],
	},
];

export async function seedSegments(projects, people) {
	console.log("\nSeeding segments...");
	const elena = people.byEmail.get("elena.novak@rheostat.team");
	const documents = await Segment.insertMany(
		segmentRows.map(({ project, ...row }, index) => {
			const createdAt = daysAgo(50 - index);
			return { ...row, projectId: projects.byKey.get(project)._id, createdBy: elena._id, createdAt, updatedAt: createdAt };
		}),
	);
	console.log(`  Created ${documents.length} segments`);
	const byProject = new Map();
	for (const segment of documents) {
		const key = projects.projects.find((project) => project._id.equals(segment.projectId)).key;
		if (!byProject.has(key)) byProject.set(key, []);
		byProject.get(key).push(segment);
	}
	return { segments: documents, byProject };
}
