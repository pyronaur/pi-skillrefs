import type { RefInjectionAdapter } from "./RefInjectionAdapter.js";

type CompactionBoundary = {
	compactionIndex: number;
	firstKeptIndex: number;
};

function latestCompactionIndex<TMessage, TBranchEntry>(
	adapter: RefInjectionAdapter<TMessage, TBranchEntry>,
	branch: readonly TBranchEntry[],
): number {
	for (let index = branch.length - 1; index >= 0; index -= 1) {
		const entry = branch[index];
		if (entry && adapter.compactionFirstKeptEntryId(entry) !== undefined) {
			return index;
		}
	}
	return -1;
}

function compactionBoundary<TMessage, TBranchEntry>(
	adapter: RefInjectionAdapter<TMessage, TBranchEntry>,
	branch: readonly TBranchEntry[] | undefined,
): CompactionBoundary | undefined {
	if (!branch) {
		return undefined;
	}

	const compactionIndex = latestCompactionIndex(adapter, branch);
	const compactionEntry = branch[compactionIndex];
	const firstKeptEntryId = compactionEntry
		? adapter.compactionFirstKeptEntryId(compactionEntry)
		: undefined;
	if (!firstKeptEntryId) {
		return undefined;
	}
	const firstKeptIndex = branch.findIndex((entry) =>
		adapter.branchEntryId(entry) === firstKeptEntryId
	);
	if (firstKeptIndex < 0) {
		return undefined;
	}

	return { compactionIndex, firstKeptIndex };
}

export function firstPostCompactionContextMessageIndex<TMessage, TBranchEntry>(
	adapter: RefInjectionAdapter<TMessage, TBranchEntry>,
	branch: readonly TBranchEntry[] | undefined,
): number {
	const boundary = compactionBoundary(adapter, branch);
	if (!boundary || !branch) {
		return 0;
	}

	return 1 + branch.slice(boundary.firstKeptIndex, boundary.compactionIndex)
		.filter((entry) => adapter.branchEntryHasContextMessage(entry))
		.length;
}

export function firstPostCompactionRefOccurrenceIndex<TMessage, TBranchEntry>(
	adapter: RefInjectionAdapter<TMessage, TBranchEntry>,
	branch: readonly TBranchEntry[],
): number {
	const boundary = compactionBoundary(adapter, branch);
	if (!boundary) {
		return 0;
	}

	let occurrenceCount = 0;
	for (const branchEntry of branch.slice(boundary.firstKeptIndex, boundary.compactionIndex)) {
		const text = adapter.textFromBranchEntry(branchEntry);
		if (text && adapter.occurrenceFromText(text)) {
			occurrenceCount += 1;
		}
	}
	return occurrenceCount;
}
