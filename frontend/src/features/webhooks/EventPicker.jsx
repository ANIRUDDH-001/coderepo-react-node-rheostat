import { EVENT_GROUP_LABELS, WEBHOOK_EVENT_GROUPS } from "./webhook.api.js";

// Controlled checkbox groups over the event catalogue; `value` is the selected array and `onChange` receives the next one.
export function EventPicker({ value, onChange, disabled = false }) {
	const selected = new Set(value);
	const toggle = (event, checked) => {
		const next = new Set(selected);
		if (checked) next.add(event);
		else next.delete(event);
		onChange(WEBHOOK_EVENT_GROUPS.flag.concat(WEBHOOK_EVENT_GROUPS.changeRequest, WEBHOOK_EVENT_GROUPS.rollout).filter((entry) => next.has(entry)));
	};
	const toggleGroup = (events, checked) => {
		const next = new Set(selected);
		for (const event of events) if (checked) next.add(event);
		else next.delete(event);
		onChange(Object.values(WEBHOOK_EVENT_GROUPS).flat().filter((entry) => next.has(entry)));
	};
	return (
		<div className="event-picker">
			{Object.entries(WEBHOOK_EVENT_GROUPS).map(([group, events]) => {
				const all = events.every((event) => selected.has(event));
				const some = !all && events.some((event) => selected.has(event));
				return (
					<fieldset className="event-group" disabled={disabled} key={group}>
						<legend>
							<label className="check-row event-group-all">
								<input
									aria-label={`Select all ${EVENT_GROUP_LABELS[group].toLowerCase()} events`}
									checked={all}
									onChange={(event) => toggleGroup(events, event.target.checked)}
									ref={(node) => {
										if (node) node.indeterminate = some;
									}}
									type="checkbox"
								/>
								<strong>{EVENT_GROUP_LABELS[group]}</strong>
							</label>
						</legend>
						<ul className="event-list">
							{events.map((event) => (
								<li key={event}>
									<label className="check-row">
										<input checked={selected.has(event)} onChange={(change) => toggle(event, change.target.checked)} type="checkbox" />
										<code>{event}</code>
									</label>
								</li>
							))}
						</ul>
					</fieldset>
				);
			})}
		</div>
	);
}
