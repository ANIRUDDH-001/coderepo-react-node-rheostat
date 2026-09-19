import { MaterialIcon } from "./MaterialIcon.jsx";

export function Pagination({ onPage, page, pageSize, total }) {
	const pages = Math.max(1, Math.ceil(total / pageSize));
	if (total === 0) return null;
	const first = (page - 1) * pageSize + 1;
	const last = Math.min(total, page * pageSize);
	return (
		<nav aria-label="Pagination" className="pagination">
			<span>
				{first}–{last} of {total}
			</span>
			<button aria-label="Previous page" className="icon-button" disabled={page <= 1} type="button" onClick={() => onPage(page - 1)}>
				<MaterialIcon>chevron_left</MaterialIcon>
			</button>
			<span className="pagination-page">
				Page {page} of {pages}
			</span>
			<button aria-label="Next page" className="icon-button" disabled={page >= pages} type="button" onClick={() => onPage(page + 1)}>
				<MaterialIcon>chevron_right</MaterialIcon>
			</button>
		</nav>
	);
}
