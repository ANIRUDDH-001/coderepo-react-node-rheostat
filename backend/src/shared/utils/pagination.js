export function paginate(query, { defaultSize = 25, maxSize = 100 } = {}) {
	const page = Math.max(1, Number.parseInt(query.page, 10) || 1);
	const pageSize = Math.min(maxSize, Math.max(1, Number.parseInt(query.pageSize, 10) || defaultSize));
	return { page, pageSize, skip: (page - 1) * pageSize };
}

export const pageResult = (items, total, page, pageSize) => ({ items, total, page, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) });
