export function createUserEntry(id, parentId, text) {
	return {
		type: "message",
		id,
		parentId,
		timestamp: new Date(0).toISOString(),
		message: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: 0,
		},
	};
}

export function createCustomSkillEntry({ id, parentId, content, details }) {
	return {
		type: "custom_message",
		id,
		parentId,
		timestamp: new Date(0).toISOString(),
		customType: "pi-skillrefs",
		content,
		display: true,
		details,
	};
}

export function createCompactionEntry(id, parentId, firstKeptEntryId) {
	return {
		type: "compaction",
		id,
		parentId,
		timestamp: new Date(0).toISOString(),
		summary: "Compacted",
		firstKeptEntryId,
		tokensBefore: 1000,
	};
}

export function createSessionManager(entries, leafId) {
	return {
		getEntries() {
			return entries;
		},
		getLeafId() {
			return leafId;
		},
	};
}
