import { Router } from "express";
import { createSegment, deleteSegment, getSegment, listSegments, updateSegment } from "./segment.controller.js";

export const segmentRouter = Router({ mergeParams: true });
segmentRouter.get("/", listSegments);
segmentRouter.post("/", createSegment);
segmentRouter.get("/:segmentKey", getSegment);
segmentRouter.patch("/:segmentKey", updateSegment);
segmentRouter.delete("/:segmentKey", deleteSegment);
