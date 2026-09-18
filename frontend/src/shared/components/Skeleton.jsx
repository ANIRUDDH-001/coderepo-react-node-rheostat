export function Skeleton({ className = "", label = "Loading", rows = 5 }) {
	return (
		<div className={`skeleton ${className}`} aria-label={label} role="status">
			{Array.from({ length: rows }, (_, index) => (
				<span key={index} />
			))}
		</div>
	);
}
