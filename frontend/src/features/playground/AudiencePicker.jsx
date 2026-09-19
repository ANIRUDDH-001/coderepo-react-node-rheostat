import { useEffect, useRef, useState } from "react";
import { MaterialIcon } from "../../shared/components/MaterialIcon.jsx";
import { useDebouncedValue } from "../../shared/hooks/useAsync.js";
import { evaluationApi } from "./evaluation.api.js";

// Search popover over the seeded synthetic audience; selecting a member loads it as the context.
export function AudiencePicker({ disabled, onSelect, projectKey }) {
	const [open, setOpen] = useState(false);
	const [search, setSearch] = useState("");
	const [state, setState] = useState({ items: [], loading: false, error: null });
	const debounced = useDebouncedValue(search, 250);
	const reference = useRef(null);

	useEffect(() => {
		if (!open) return undefined;
		let active = true;
		setState((previous) => ({ ...previous, loading: true, error: null }));
		evaluationApi
			.audience(projectKey, { search: debounced, limit: 12 })
			.then((items) => active && setState({ items, loading: false, error: null }))
			.catch((error) => active && setState({ items: [], loading: false, error }));
		return () => {
			active = false;
		};
	}, [open, debounced, projectKey]);

	useEffect(() => {
		if (!open) return undefined;
		const closeOutside = (event) => {
			if (!reference.current?.contains(event.target)) setOpen(false);
		};
		const closeOnEscape = (event) => {
			if (event.key === "Escape") {
				setOpen(false);
				reference.current?.querySelector("button")?.focus();
			}
		};
		document.addEventListener("pointerdown", closeOutside);
		document.addEventListener("keydown", closeOnEscape);
		return () => {
			document.removeEventListener("pointerdown", closeOutside);
			document.removeEventListener("keydown", closeOnEscape);
		};
	}, [open]);

	return (
		<div className="audience-picker" ref={reference}>
			<button
				aria-expanded={open}
				aria-haspopup="dialog"
				className="tonal-button"
				disabled={disabled}
				type="button"
				onClick={() => setOpen((value) => !value)}
			>
				<MaterialIcon size={18}>person</MaterialIcon> Load audience member
			</button>
			{open && (
				<div aria-label="Audience members" className="audience-popover" role="dialog">
					<label className="filter-search">
						<MaterialIcon size={20}>search</MaterialIcon>
						<input
							autoFocus
							aria-label="Search audience"
							placeholder="Name, key, or company"
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
						/>
					</label>
					{state.error && <p className="form-error">{state.error.message}</p>}
					{state.loading && !state.items.length && <p className="muted">Searching…</p>}
					{!state.loading && !state.error && !state.items.length && <p className="muted">No members match.</p>}
					<ul>
						{state.items.map((member) => (
							<li key={member._id}>
								<button
									type="button"
									onClick={() => {
										onSelect(member);
										setOpen(false);
									}}
								>
									<strong>{member.name}</strong>
									<span className="muted">
										{member.attributes.plan} · {member.attributes.country} · {member.attributes.platform}{" "}
										{member.attributes.appVersion}
									</span>
									<code>{member.key}</code>
								</button>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>
	);
}
