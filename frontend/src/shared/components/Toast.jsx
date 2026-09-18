import { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";
import { MaterialIcon } from "./MaterialIcon.jsx";

const ToastContext = createContext({ notify: () => {} });
const ICONS = { success: "check_circle", error: "error_outline", info: "info" };
const MAX_VISIBLE = 3;
const DISMISS_MS = 5000;

export function ToastProvider({ children }) {
	const [toasts, setToasts] = useState([]);
	const counter = useRef(0);
	const dismiss = useCallback((id) => setToasts((items) => items.filter((item) => item.id !== id)), []);
	const notify = useCallback(
		({ kind = "info", message }) => {
			const id = (counter.current += 1);
			setToasts((items) => [...items.slice(-(MAX_VISIBLE - 1)), { id, kind, message }]);
			window.setTimeout(() => dismiss(id), DISMISS_MS);
		},
		[dismiss],
	);
	const value = useMemo(() => ({ notify }), [notify]);
	return (
		<ToastContext.Provider value={value}>
			{children}
			<div className="toast-host" aria-live="polite">
				{toasts.map((toast) => (
					<div className={`toast toast-${toast.kind}`} key={toast.id} role="status">
						<MaterialIcon size={20}>{ICONS[toast.kind] || ICONS.info}</MaterialIcon>
						<span>{toast.message}</span>
						<button type="button" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
							<MaterialIcon size={18}>close</MaterialIcon>
						</button>
					</div>
				))}
			</div>
		</ToastContext.Provider>
	);
}

export const useToast = () => useContext(ToastContext);
