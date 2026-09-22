import { Badge } from "../../shared/components/Badge.jsx";

export function StatusBadge({ subscription }) {
	if (subscription.enabled) return <Badge tone="success">Enabled</Badge>;
	if (subscription.disabledReason === "AUTO_FAILURES") return <Badge title="Disabled automatically after 5 consecutive dead-lettered deliveries" tone="danger">Auto-disabled</Badge>;
	return <Badge tone="neutral">Disabled</Badge>;
}

const DELIVERY = { delivered: ["success", "Delivered"], dead: ["danger", "Dead-lettered"], pending: ["warning", "Retrying"], delivering: ["info", "Sending"], held: ["neutral", "Held"] };
export function DeliveryStatusBadge({ status }) {
	const [tone, label] = DELIVERY[status] || ["neutral", status];
	return <Badge tone={tone}>{label}</Badge>;
}
