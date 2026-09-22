import mongoose from "mongoose";

// Opaque "<createdAt ISO>_<ObjectId>" cursor. Two fields, because createdAt alone is not unique.
export const encodeCursor = (row) => `${new Date(row.createdAt).toISOString()}_${String(row._id)}`;

export function decodeCursor(value) {
	const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)_([0-9a-f]{24})$/.exec(value || "");
	if (!match) return null;
	const createdAt = new Date(match[1]);
	return Number.isNaN(createdAt.getTime()) ? null : { createdAt, id: match[2] };
}

export const cursorPredicate = ({ createdAt, id }) => ({ $or: [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: id } }] });

export const toObjectIdPredicate = ({ createdAt, id }) => cursorPredicate({ createdAt, id: new mongoose.Types.ObjectId(id) });
