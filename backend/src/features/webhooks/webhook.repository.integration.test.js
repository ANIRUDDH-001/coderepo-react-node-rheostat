import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import mongoose from "mongoose";

const uri = process.env.MONGODB_TEST_URI;
const { deliveryRepository, receiptRepository } = await import("./webhook.repository.js");
const { WebhookDelivery } = await import("./webhook-delivery.model.js");
const { WebhookReceipt } = await import("./webhook-receipt.model.js");
const { decodeCursor, encodeCursor } = await import("./cursor.js");

const sid = new mongoose.Types.ObjectId();
const pid = new mongoose.Types.ObjectId();
const doc = (eventId, extra = {}) => ({
	subscriptionId: sid,
	projectId: pid,
	eventId,
	event: "flag.archived",
	payload: {},
	status: "pending",
	attempts: [],
	budgetFrom: 0,
	nextAttemptAt: new Date(0),
	claimedAt: null,
	deliveredAt: null,
	...extra,
});

describe.skipIf(!uri)("webhook delivery repository (Mongo)", () => {
	beforeAll(async () => {
		await mongoose.connect(uri);
		await WebhookDelivery.deleteMany({});
		await WebhookReceipt.deleteMany({});
		await WebhookDelivery.syncIndexes();
		await WebhookReceipt.syncIndexes();
	});
	afterAll(async () => {
		await WebhookDelivery.deleteMany({});
		await WebhookReceipt.deleteMany({});
		await mongoose.disconnect();
	});
	test("two concurrent claimNext calls yield exactly one claimant", async () => {
		await WebhookDelivery.insertMany([doc("race")]);
		const now = new Date();
		const [a, b] = await Promise.all([deliveryRepository.claimNext(now), deliveryRepository.claimNext(now)]);
		expect([a, b].filter(Boolean)).toHaveLength(1);
		expect(await WebhookDelivery.countDocuments({ status: "delivering" })).toBe(1);
	});
	test("duplicate (subscriptionId, eventId) inserts are skipped, not fatal", async () => {
		const first = await deliveryRepository.insertMany([doc("dup")]);
		const second = await deliveryRepository.insertMany([doc("dup"), doc("fresh")]);
		expect(first).toHaveLength(1);
		expect(second.map((entry) => entry.eventId)).toEqual(["fresh"]);
		expect(await WebhookDelivery.countDocuments({ eventId: "dup" })).toBe(1);
	});
	test("compound cursor pages rows that share createdAt without skipping or repeating", async () => {
		const createdAt = new Date("2026-09-21T10:00:00.000Z");
		await WebhookDelivery.deleteMany({});
		await WebhookDelivery.insertMany(
			Array.from({ length: 5 }, (_, index) => ({ ...doc(`same-${index}`), createdAt, updatedAt: createdAt })),
		);
		const seen = [];
		let cursor = null;
		for (;;) {
			const rows = await deliveryRepository.findPage(sid, { cursor: cursor ? decodeCursor(cursor) : null, limit: 2 });
			const page = rows.slice(0, 2);
			seen.push(...page.map((row) => row.eventId));
			if (rows.length <= 2) break;
			cursor = encodeCursor(page.at(-1));
		}
		expect(seen.sort()).toEqual(["same-0", "same-1", "same-2", "same-3", "same-4"]);
		expect(new Set(seen).size).toBe(5);
	});
	test("receipt upsert: the first request inserts, concurrent duplicates increment one document", async () => {
		const receipt = (at) => ({
			projectId: pid,
			subscriptionId: sid,
			dedupeKey: "d-1",
			deliveryId: "d-1",
			event: "flag.archived",
			lastReceivedAt: at,
			headers: {},
			body: "{}",
			signatureValid: true,
			signatureError: "",
		});
		const first = await receiptRepository.record(receipt(new Date("2026-09-21T10:00:00.000Z")));
		expect(first).toMatchObject({ receivedCount: 1, firstReceivedAt: new Date("2026-09-21T10:00:00.000Z") });
		const later = new Date("2026-09-21T10:00:05.000Z");
		await Promise.all(Array.from({ length: 4 }, () => receiptRepository.record(receipt(later))));
		const docs = await WebhookReceipt.find({ projectId: pid, dedupeKey: "d-1" }).lean();
		expect(docs).toHaveLength(1);
		expect(docs[0]).toMatchObject({ receivedCount: 5, firstReceivedAt: new Date("2026-09-21T10:00:00.000Z"), lastReceivedAt: later });
	});
});
