import mongoose from "mongoose";
import { AppError } from "../errors/app-error.js";

export function ensureObjectId(id, code, message) {
	if (!mongoose.isValidObjectId(id)) throw new AppError(404, code, message);
	return String(id);
}

export const sameId = (left, right) => String(left) === String(right);
