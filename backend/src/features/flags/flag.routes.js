import { Router } from "express";
import {
	activateKillSwitch,
	archiveFlag,
	clearKillSwitch,
	createFlag,
	getFlag,
	listFlags,
	listVersions,
	restoreFlag,
	updateFlagMetadata,
} from "./flag.controller.js";

export const flagRouter = Router({ mergeParams: true });
flagRouter.get("/", listFlags);
flagRouter.post("/", createFlag);
flagRouter.get("/:flagKey", getFlag);
flagRouter.patch("/:flagKey", updateFlagMetadata);
flagRouter.post("/:flagKey/archive", archiveFlag);
flagRouter.post("/:flagKey/restore", restoreFlag);
flagRouter.get("/:flagKey/environments/:environment/versions", listVersions);
flagRouter.post("/:flagKey/kill-switch", activateKillSwitch);
flagRouter.delete("/:flagKey/kill-switch", clearKillSwitch);
