import { useState } from "react";
import { FormField } from "../../shared/components/FormField.jsx";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";

export function ReviewPanel({ changeRequest, isAuthor, onReview, canReview, reason = "" }) {
	const [comment, setComment] = useState("");
	const [busy, setBusy] = useState("");
	const [error, setError] = useState("");
	const approvals = changeRequest.reviews.filter((review) => review.decision === "approve").length;
	const open = changeRequest.status === "pending";
	const submit = async (decision) => {
		setBusy(decision);
		setError("");
		try {
			await onReview(decision, comment.trim());
			setComment("");
		} catch (caught) {
			setError(caught.message);
		} finally {
			setBusy("");
		}
	};
	return (
		<section className="review-panel" aria-labelledby="reviews-title">
			<div className="editor-section-header">
				<h3 id="reviews-title">Reviews</h3>
				<span className="muted">
					{approvals}/{changeRequest.policy.requiredApprovals} approval{changeRequest.policy.requiredApprovals === 1 ? "" : "s"}
				</span>
			</div>
			{changeRequest.reviews.length === 0 && <p className="muted">No reviews yet.</p>}
			<ul className="review-list">
				{changeRequest.reviews.map((review) => (
					<li className={`review review-${review.decision}`} key={`${review.reviewerId}-${review.at}`}>
						<MaterialIcon size={18}>{review.decision === "approve" ? "check_circle" : "close"}</MaterialIcon>
						{review.reviewer && <ProfileAvatar profile={review.reviewer} size="small" />}
						<div className="review-body">
							<strong>
								{review.reviewer?.name || "Unknown"} {review.decision === "approve" ? "approved" : "rejected"}
							</strong>
							<time dateTime={review.at} title={formatDateTime(review.at)}>
								{relativeTime(review.at)}
							</time>
							{review.comment && <p>{review.comment}</p>}
						</div>
					</li>
				))}
			</ul>
			{open && canReview && !isAuthor && (
				<div className="review-form">
					<FormField error={error} label="Review comment (optional)">
						{(props) => (
							<textarea
								{...props}
								disabled={Boolean(busy)}
								maxLength={2000}
								rows={2}
								value={comment}
								onChange={(event) => setComment(event.target.value)}
							/>
						)}
					</FormField>
					<div className="editor-actions">
						<button className="danger-outline-button" disabled={Boolean(busy)} type="button" onClick={() => submit("reject")}>
							{busy === "reject" ? "Rejecting…" : "Reject"}
						</button>
						<button className="primary-button" disabled={Boolean(busy)} type="button" onClick={() => submit("approve")}>
							{busy === "approve" ? "Approving…" : "Approve"}
						</button>
					</div>
				</div>
			)}
			{open && !canReview && !isAuthor && reason && <p className="muted review-note">{reason}</p>}
			{open && isAuthor && <p className="muted review-note">Authors cannot review their own change request.</p>}
		</section>
	);
}
