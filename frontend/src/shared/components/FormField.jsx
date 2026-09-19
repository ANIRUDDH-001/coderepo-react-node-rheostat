import { useId } from "react";

// Label + control + hint/error, with aria wiring. `children` is a render function receiving the control props.
export function FormField({ children, className = "", error = "", hint = "", label, required = false }) {
	const id = useId();
	const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
	return (
		<div className={`form-field ${error ? "form-field-invalid" : ""} ${className}`}>
			<label htmlFor={id}>
				{label}
				{required && <span aria-hidden="true"> *</span>}
			</label>
			{children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
			{error ? (
				<span className="form-error" id={`${id}-error`} role="alert">
					{error}
				</span>
			) : (
				hint && (
					<span className="form-hint" id={`${id}-hint`}>
						{hint}
					</span>
				)
			)}
		</div>
	);
}
