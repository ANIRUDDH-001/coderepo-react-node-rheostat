import { EvaluationLog } from "../../features/evaluation/evaluation-log.model.js";
import { evaluate } from "../../features/evaluation/evaluator.js";
import { daysAgo } from "./clock.js";
import { between, pick, prng } from "./prng.js";

// About 2,500 simulated evaluations over the last 14 days, produced by running the real evaluator over the seeded
// audience against each active flag's production configuration, so the dashboard distributions are truthful.
const DAYS = 14;
const PER_PROJECT_PER_DAY = 90;

export function buildEvaluationLogs(projects, flags, segments, audience) {
	const random = prng(20260921);
	const logs = [];
	for (const project of projects.projects) {
		const projectFlags = flags.flags.filter((flag) => flag.projectId.equals(project._id) && !flag.archived);
		const members = audience.filter((member) => member.projectId.equals(project._id));
		const segmentsByKey = Object.fromEntries(
			(segments.byProject.get(project.key) || []).map((segment) => [segment.key, segment.toObject ? segment.toObject() : segment]),
		);
		for (let day = DAYS - 1; day >= 0; day -= 1) {
			// Traffic grows toward today and dips on the two most recent weekend-like days for a realistic shape.
			const volume = Math.round(PER_PROJECT_PER_DAY * (0.7 + (DAYS - day) / DAYS) * (day % 7 === 5 || day % 7 === 6 ? 0.55 : 1));
			for (let index = 0; index < volume; index += 1) {
				const flag = pick(random, projectFlags);
				const member = pick(random, members);
				const context = { key: member.key, attributes: member.attributes };
				const outcome = evaluate(flag.toObject ? flag.toObject() : flag, "production", context, segmentsByKey);
				logs.push({
					projectId: project._id,
					flagId: flag._id,
					flagKey: flag.key,
					environment: "production",
					contextKey: member.key,
					variationId: outcome.variationId,
					reasonKind: outcome.reason.kind,
					source: "simulated",
					at: daysAgo(day, between(random, 6, 22), between(random, 0, 59)),
				});
			}
		}
	}
	return logs;
}

export async function seedEvaluationLogs(projects, flags, segments, audience) {
	console.log("\nSeeding simulated evaluation logs...");
	const logs = await EvaluationLog.insertMany(buildEvaluationLogs(projects, flags, segments, audience));
	console.log(`  Created ${logs.length} evaluation logs over the last ${DAYS} days`);
	return logs;
}
