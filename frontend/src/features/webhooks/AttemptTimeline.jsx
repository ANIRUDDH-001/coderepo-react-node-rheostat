import { formatDateTime, relativeTime } from "../../shared/utils/date.js";

const describe = (attempt) =>
	attempt.responseStatus ? `HTTP ${attempt.responseStatus} · ${attempt.durationMs} ms` : `${attempt.error} · ${attempt.durationMs} ms`;

export function AttemptTimeline({ attempts, budgetFrom = 0, nextAttemptAt, status }) {
	return (
		<ol className="attempt-timeline">
			{attempts.map((attempt, index) => (
				<li className={`attempt attempt-${attempt.outcome}`} key={`${attempt.at}-${index}`}>
					{budgetFrom > 0 && index === budgetFrom && <span className="attempt-marker">Redelivered — retry budget restarted</span>}
					<strong>Attempt {index + 1}</strong>
					<time dateTime={attempt.at} title={formatDateTime(attempt.at)}>
						{relativeTime(attempt.at)}
					</time>
					<span>{describe(attempt)}</span>
				</li>
			))}
			{status === "pending" && nextAttemptAt && (
				<li className="attempt attempt-next">
					<strong>Next attempt</strong>
					<time dateTime={nextAttemptAt} title={formatDateTime(nextAttemptAt)}>
						{relativeTime(nextAttemptAt)}
					</time>
				</li>
			)}
			{status === "held" && (
				<li className="attempt attempt-next">
					<strong>Held</strong>
					<span>The webhook is disabled; enable it to resume.</span>
				</li>
			)}
			{status === "dead" && (
				<li className="attempt attempt-dead">
					<strong>Dead-lettered</strong>
					<span>No more automatic retries. Redeliver to try again.</span>
				</li>
			)}
			{attempts.length === 0 && status !== "dead" && (
				<li className="attempt">
					<span className="muted">Not sent yet.</span>
				</li>
			)}
		</ol>
	);
}
