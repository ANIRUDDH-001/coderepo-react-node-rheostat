import { personService } from "../people/person.service.js";
import { projectService } from "../projects/project.service.js";
import { dashboardService } from "./dashboard.service.js";

export async function getDashboard(request, response, next) {
	try {
		const project = await projectService.getByKey(request.params.projectKey);
		const payload = await dashboardService.get(project, request.profile);
		const [recentProductionChanges, killSwitches] = await Promise.all([
			personService.attachActors(payload.recentProductionChanges),
			personService.attachActors(payload.killSwitches),
		]);
		response.json({ data: { ...payload, recentProductionChanges, killSwitches } });
	} catch (error) {
		next(error);
	}
}
