import { SavedView } from "../../features/saved-views/saved-view.model.js";
import { daysAgo } from "./clock.js";

// Personal flags-list presets: two for Diego (developer), one for Marcus (release manager).
export async function seedSavedViews(projects, people) {
	console.log("\nSeeding saved views...");
	const diego = people.byEmail.get("diego.alvarez@rheostat.team");
	const marcus = people.byEmail.get("marcus.chen@rheostat.team");
	const storefront = projects.byKey.get("storefront");
	const rows = [
		{
			ownerId: diego._id,
			projectId: storefront._id,
			name: "Checkout work",
			filters: { tags: ["checkout"] },
			sort: "updated",
			createdAt: daysAgo(9, 11),
		},
		{
			ownerId: diego._id,
			projectId: storefront._id,
			name: "Off in production",
			filters: { environment: "production", state: "off" },
			sort: "name",
			createdAt: daysAgo(6, 15),
		},
		{
			ownerId: marcus._id,
			projectId: storefront._id,
			name: "Cleanup candidates",
			filters: { lifecycle: "temporary", stale: "readyToRemove" },
			sort: "stale",
			createdAt: daysAgo(4, 9),
		},
	];
	const views = await SavedView.insertMany(rows.map((row) => ({ ...row, updatedAt: row.createdAt })));
	console.log(`  Created ${views.length} saved views`);
	return views;
}
