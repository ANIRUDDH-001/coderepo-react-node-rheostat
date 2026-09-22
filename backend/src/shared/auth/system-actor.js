import mongoose from "mongoose";

// Automated writers (webhook worker, rollout steps) record this actor; it is a constant, not a Person document.
export const SYSTEM_ACTOR_ID = new mongoose.Types.ObjectId("000000000000000000000001");
export const SYSTEM_ACTOR = { _id: SYSTEM_ACTOR_ID, name: "Rheostat", system: true };
export const isSystemActor = (id) => String(id) === String(SYSTEM_ACTOR_ID);
