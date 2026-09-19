import { useRef } from "react";

// Accessible tab strip: arrow keys move focus and selection, Home/End jump.
export function Tabs({ ariaLabel, className = "", items, onChange, value }) {
	const references = useRef([]);
	const activate = (index) => {
		const item = items[(index + items.length) % items.length];
		onChange(item.value);
		references.current[(index + items.length) % items.length]?.focus();
	};
	return (
		<div aria-label={ariaLabel} className={`tabs ${className}`} role="tablist">
			{items.map((item, index) => {
				const selected = item.value === value;
				return (
					<button
						aria-selected={selected}
						className={selected ? "tab tab-active" : "tab"}
						disabled={item.disabled}
						id={item.id}
						key={item.value}
						ref={(element) => {
							references.current[index] = element;
						}}
						role="tab"
						tabIndex={selected ? 0 : -1}
						type="button"
						onClick={() => onChange(item.value)}
						onKeyDown={(event) => {
							if (event.key === "ArrowRight") activate(index + 1);
							else if (event.key === "ArrowLeft") activate(index - 1);
							else if (event.key === "Home") activate(0);
							else if (event.key === "End") activate(items.length - 1);
							else return;
							event.preventDefault();
						}}
					>
						{item.icon}
						<span>{item.label}</span>
						{item.badge !== undefined && item.badge !== null && <span className="tab-badge">{item.badge}</span>}
					</button>
				);
			})}
		</div>
	);
}
