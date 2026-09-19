import { useState } from "react";
import { FormField } from "../../shared/components/FormField.jsx";
import { formatDateTime, relativeTime } from "../../shared/utils/date.js";
import { ProfileAvatar } from "../profiles/ProfileAvatar.jsx";

const MAX_BODY = 2000;

export function CommentThread({ canComment, comments, onSubmit }) {
	const [body, setBody] = useState("");
	const [error, setError] = useState("");
	const [busy, setBusy] = useState(false);
	const submit = async (event) => {
		event.preventDefault();
		const text = body.trim();
		if (!text) return;
		if (text.length > MAX_BODY) {
			setError(`Comments are limited to ${MAX_BODY} characters (${text.length} entered).`);
			return;
		}
		setBusy(true);
		setError("");
		try {
			await onSubmit(text);
			setBody("");
		} catch (caught) {
			setError(caught.details?.fieldErrors?.body?.[0] || caught.message);
		} finally {
			setBusy(false);
		}
	};
	return (
		<section className="comment-thread" aria-labelledby="comments-title">
			<h3 id="comments-title">Comments</h3>
			{comments.length === 0 && <p className="muted">No comments yet.</p>}
			<ol className="comment-list">
				{comments.map((comment) => (
					<li className="comment" key={comment.id}>
						{comment.author ? (
							<ProfileAvatar profile={comment.author} size="small" />
						) : (
							<span className="profile-avatar profile-avatar-small" />
						)}
						<div className="comment-body">
							<div className="comment-head">
								<strong>{comment.author?.name || "Unknown"}</strong>
								<time dateTime={comment.at} title={formatDateTime(comment.at)}>
									{relativeTime(comment.at)}
								</time>
							</div>
							<p>{comment.body}</p>
						</div>
					</li>
				))}
			</ol>
			{canComment ? (
				<form className="comment-form" onSubmit={submit}>
					<FormField error={error} hint={`${body.length}/${MAX_BODY}`} label="Add a comment">
						{(props) => (
							<textarea {...props} disabled={busy} rows={3} value={body} onChange={(event) => setBody(event.target.value)} />
						)}
					</FormField>
					<div className="editor-actions">
						<button className="tonal-button" disabled={busy || !body.trim()} type="submit">
							{busy ? "Posting…" : "Post comment"}
						</button>
					</div>
				</form>
			) : (
				<p className="muted">Your role can read comments but not post them.</p>
			)}
		</section>
	);
}
