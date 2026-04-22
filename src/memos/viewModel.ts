import type { MemoEntry } from "../types";

export interface TagStat {
	tag: string;
	count: number;
}

export interface HeatmapCell {
	dayKey: string;
	count: number;
	level: number;
	isToday: boolean;
}

export interface HeatmapWeek {
	key: string;
	cells: HeatmapCell[];
}

export interface HeatmapMonthLabel {
	label: string;
	column: number;
}

export type MemosSortOrder =
	| "created-desc"
	| "created-asc"
	| "updated-desc"
	| "updated-asc";

export type MemosStatusFilter = "all" | "active" | "archived" | "deleted";

export interface MemosViewModel {
	filteredMemos: MemoEntry[];
	tagStats: TagStat[];
	heatmap: HeatmapWeek[];
	heatmapMonths: HeatmapMonthLabel[];
	totalMemos: number;
	totalTags: number;
	totalDays: number;
}

export function buildViewModel(
	memos: MemoEntry[],
	searchTerm: string,
	activeTag: string | null,
	activeDayKey: string | null,
	sortOrder: MemosSortOrder,
	statusFilter: MemosStatusFilter,
): MemosViewModel {
	const normalizedSearch = searchTerm.trim().toLowerCase();
	const scopedMemos = memos.filter((memo) => matchesStatusFilter(memo, statusFilter));
	const filteredMemos = scopedMemos
		.filter((memo) => {
			const matchesTag = !activeTag || memo.tags.includes(activeTag);
			const matchesDay = !activeDayKey || memo.dayKey === activeDayKey;
			const matchesSearch =
				!normalizedSearch ||
				memo.content.toLowerCase().includes(normalizedSearch) ||
				memo.sourceBasename.toLowerCase().includes(normalizedSearch) ||
				memo.tags.some((tag) => tag.toLowerCase().includes(normalizedSearch));
			return matchesTag && matchesDay && matchesSearch;
		})
		.sort((left, right) => compareMemos(left, right, sortOrder));

	const tagCounts = new Map<string, number>();
	const dayCounts = new Map<string, number>();

	for (const memo of scopedMemos) {
		dayCounts.set(memo.dayKey, (dayCounts.get(memo.dayKey) ?? 0) + 1);
		for (const tag of memo.tags) {
			tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
		}
	}

	const heatmapMax = Math.max(...dayCounts.values(), 1);
	const { heatmap, heatmapMonths } = buildHeatmap(dayCounts, heatmapMax);

	const tagStats = [...tagCounts.entries()]
		.map(([tag, count]) => ({ tag, count }))
		.sort((left, right) => left.tag.localeCompare(right.tag, undefined, { numeric: true }));

	return {
		filteredMemos,
		tagStats,
		heatmap,
		heatmapMonths,
		totalMemos: scopedMemos.length,
		totalTags: tagCounts.size,
		totalDays: dayCounts.size,
	};
}

function matchesStatusFilter(memo: MemoEntry, statusFilter: MemosStatusFilter): boolean {
	switch (statusFilter) {
		case "all":
			return !memo.archivedAt && !memo.deletedAt;
		case "archived":
			return Boolean(memo.archivedAt);
		case "deleted":
			return Boolean(memo.deletedAt);
		case "active":
		default:
			return !memo.archivedAt && !memo.deletedAt;
	}
}

function compareMemos(left: MemoEntry, right: MemoEntry, sortOrder: MemosSortOrder): number {
	switch (sortOrder) {
		case "created-asc":
			return left.createdAt - right.createdAt;
		case "updated-desc":
			return right.updatedAt - left.updatedAt || right.createdAt - left.createdAt;
		case "updated-asc":
			return left.updatedAt - right.updatedAt || left.createdAt - right.createdAt;
		case "created-desc":
		default:
			return right.createdAt - left.createdAt;
	}
}

function buildHeatmap(
	dayCounts: Map<string, number>,
	heatmapMax: number,
): { heatmap: HeatmapWeek[]; heatmapMonths: HeatmapMonthLabel[] } {
	const today = startOfDay(new Date());
	const weekCount = 12;
	const startDate = addDays(startOfWeek(today), -(weekCount - 1) * 7);
	const heatmap: HeatmapWeek[] = [];
	const heatmapMonths: HeatmapMonthLabel[] = [];
	const seenMonths = new Set<string>();

	for (let weekIndex = 0; weekIndex < weekCount; weekIndex += 1) {
		const weekStart = addDays(startDate, weekIndex * 7);
		const cells: HeatmapCell[] = [];

		for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
			const currentDate = addDays(weekStart, dayIndex);
			const dayKey = formatLocalDayKey(currentDate);
			const count = dayCounts.get(dayKey) ?? 0;

			cells.push({
				dayKey,
				count,
				level: count > 0 ? Math.max(1, Math.ceil((count / heatmapMax) * 4)) : 0,
				isToday: currentDate.getTime() === today.getTime(),
			});

			if (currentDate.getDate() === 1 || (weekIndex === 0 && dayIndex === 0)) {
				const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`;
				if (!seenMonths.has(monthKey)) {
					seenMonths.add(monthKey);
					heatmapMonths.push({
						label: formatMonthLabel(currentDate),
						column: weekIndex + 1,
					});
				}
			}
		}

		heatmap.push({
			key: formatLocalDayKey(weekStart),
			cells,
		});
	}

	return { heatmap, heatmapMonths };
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfWeek(date: Date): Date {
	const day = date.getDay();
	const mondayOffset = day === 0 ? -6 : 1 - day;
	return addDays(startOfDay(date), mondayOffset);
}

function addDays(date: Date, days: number): Date {
	const nextDate = new Date(date);
	nextDate.setDate(nextDate.getDate() + days);
	return startOfDay(nextDate);
}

function formatLocalDayKey(date: Date): string {
	const year = date.getFullYear();
	const month = String(date.getMonth() + 1).padStart(2, "0");
	const day = String(date.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
}

function formatMonthLabel(date: Date): string {
	return ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][date.getMonth()] ?? "";
}
