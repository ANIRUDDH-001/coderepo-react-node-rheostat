import { useEffect, useRef } from "react";

export function Modal({ children, className = "", label = "Rheostat dialog", labelledBy, onClose }) {
	const reference = useRef(null);
	const closeReference = useRef(onClose);
	useEffect(() => {
		closeReference.current = onClose;
	}, [onClose]);
	useEffect(() => {
		const dialog = reference.current;
		// Return focus to whatever opened the dialog once it unmounts (React removes the element, so the
		// browser's own focus restoration never runs).
		const opener = document.activeElement;
		dialog.showModal();
		window.requestAnimationFrame(() => dialog.querySelector("[autofocus], [data-autofocus]")?.focus());
		const cancel = (event) => {
			event.preventDefault();
			closeReference.current();
		};
		dialog.addEventListener("cancel", cancel);
		return () => {
			dialog.removeEventListener("cancel", cancel);
			if (opener && typeof opener.focus === "function" && document.contains(opener)) opener.focus();
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
