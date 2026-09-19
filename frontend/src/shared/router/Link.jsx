import { navigate } from "./router.js";

const isPlainLeftClick = (event) => event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;

export function Link({ children, className = "", onClick, replace = false, to, ...rest }) {
	return (
		<a
			{...rest}
			className={className}
			href={to}
			onClick={(event) => {
				onClick?.(event);
				if (event.defaultPrevented || !isPlainLeftClick(event) || rest.target) return;
				event.preventDefault();
				navigate(to, { replace });
			}}
		>
			{children}
		</a>
	);
}
