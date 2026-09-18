export function BrandMark({ className = "" }) {
	return (
		<span className={`brand-dial ${className}`} aria-hidden="true">
			<svg viewBox="0 0 44 44" focusable="false">
				<path
					d="M12.1 32.9 A14 14 0 1 1 31.9 32.9"
					fill="none"
					stroke="#7fb5f5"
					strokeWidth="4"
					strokeLinecap="round"
					opacity="0.45"
				/>
				<path d="M12.1 32.9 A14 14 0 0 1 29.2 10.9" fill="none" stroke="#c2e7ff" strokeWidth="4" strokeLinecap="round" />
				<line x1="22" y1="23" x2="29.2" y2="10.9" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" />
				<circle cx="22" cy="23" r="3.2" fill="#fff" />
			</svg>
		</span>
	);
}
