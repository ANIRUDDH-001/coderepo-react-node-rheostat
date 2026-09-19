import { Badge } from "../../shared/components/Badge.jsx";

const STATUS = {
	pending: { label: "Pending review", tone: "info", icon: "rate_review" },
	approved: { label: "Approved", tone: "success", icon: "check_circle" },
	conflicted: { label: "Conflicted", tone: "warning", icon: "warning_amber" },
	applied: { label: "Applied", tone: "success", icon: "check" },
	rejected: { label: "Rejected", tone: "danger", icon: "close" },
	withdrawn: { label: "Withdrawn", tone: "neutral", icon: "undo" },
};

const KIND = {
	manual: { label: "Targeting change", tone: "neutral" },
	promotion: { label: "Promotion", tone: "accent" },
	rollback: { label: "Rollback", tone: "warning" },
};

export function StatusBadge({ status }) {
	const entry = STATUS[status] || { label: status, tone: "neutral" };
	return (
		<Badge icon={entry.icon} tone={entry.tone}>
			{entry.label}
		</Badge>
	);
}

export function KindBadge({ kind }) {
	const entry = KIND[kind] || { label: kind, tone: "neutral" };
	return <Badge tone={entry.tone}>{entry.label}</Badge>;
}
