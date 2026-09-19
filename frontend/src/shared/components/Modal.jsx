import { useEffect, useRef } from "react";

export function Modal({ children, className = "", label = "Rheostat dialog", labelledBy, onClose }) {
	const reference = useRef(null);
	const closeReference = useRef(onClose);
	// Captured during the first render, before showModal moves focus (and before StrictMode's effect replay).
	const openerReference = useRef(document.activeElement);
	useEffect(() => {
		closeReference.current = onClose;
	}, [onClose]);
	useEffect(() => {
		const dialog = reference.current;
		dialog.showModal();
		// Focus the preferred control once painted, and once more shortly after in case a late render moved focus.
		const focusPreferred = () => {
			const target = dialog.querySelector("[autofocus], [data-autofocus]");
			if (target && document.activeElement !== target) target.focus();
		};
		const frame = window.requestAnimationFrame(focusPreferred);
		const timer = window.setTimeout(focusPreferred, 150);
		const cancel = (event) => {
			event.preventDefault();
			closeReference.current();
		};
		dialog.addEventListener("cancel", cancel);
		return () => {
			window.cancelAnimationFrame(frame);
			window.clearTimeout(timer);
			dialog.removeEventListener("cancel", cancel);
			// React removes the element, so the browser's own focus restoration never runs; return focus to the opener.
			const opener = openerReference.current;
			if (opener && typeof opener.focus === "function" && document.contains(opener) && !dialog.isConnected) opener.focus();
		};
	}, []);
	return (
		<dialog
			aria-label={labelledBy ? undefined : label}
			aria-labelledby={labelledBy}
			ref={reference}
			className={className}
			onMouseDown={(event) => {
				if (event.target === reference.current) onClose();
			}}
		>
			{children}
		</dialog>
	);
}
