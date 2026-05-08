import type { SlashCommandInfo } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";

const SKILL_COMMAND_PREFIX = "skill:";
const MENTION_TOKEN_PATTERN = /(?:^|\s)\$([a-zA-Z0-9\-_]*)$/;
const MENTION_GLOBAL_PATTERN = /(?:^|(?<=\s))\$([a-zA-Z][a-zA-Z0-9\-_]*)/g;

type MentionedSkill = {
	name: string;
	path: string;
};

type AutocompleteRequestOptions = {
	signal?: AbortSignal;
	force?: boolean;
};

type AutocompleteArgs = [string[], number, number, AutocompleteRequestOptions?];
type CompletionArgs = [string[], number, number, AutocompleteItem, string];

function normalizeSkillName(commandName: string): string | undefined {
	if (!commandName.startsWith(SKILL_COMMAND_PREFIX)) {
		return undefined;
	}

	const name = commandName.slice(SKILL_COMMAND_PREFIX.length).trim();
	if (name.length === 0) {
		return undefined;
	}

	return name;
}

function findMentionSuggestions(
	args: AutocompleteArgs,
	getSkillItems: () => AutocompleteItem[],
): { items: AutocompleteItem[]; prefix: string } | null {
	const [lines, cursorLine, cursorCol] = args;
	const line = lines[cursorLine] || "";
	const mention = findMentionTokenAtCursor(line, cursorCol);
	if (!mention) {
		return null;
	}

	const queryLower = mention.query.toLowerCase();
	const items = getSkillItems().filter((item) => {
		if (queryLower === "") {
			return true;
		}

		return item.label.toLowerCase().includes(queryLower);
	});
	if (items.length === 0) {
		return null;
	}

	return { items, prefix: mention.token };
}

function applyMentionCompletion(args: CompletionArgs) {
	const [lines, cursorLine, cursorCol, item, prefix] = args;
	const line = lines[cursorLine] || "";
	const startCol = cursorCol - prefix.length;
	const newLine = line.slice(0, startCol) + item.value + line.slice(cursorCol);
	const newLines = [...lines];
	newLines[cursorLine] = newLine;

	return {
		lines: newLines,
		cursorLine,
		cursorCol: startCol + item.value.length,
	};
}

function copyOptionalMethod(target: unknown, baseProvider: unknown, name: string): void {
	if (typeof target !== "object" || target === null) {
		return;
	}
	if (typeof baseProvider !== "object" || baseProvider === null) {
		return;
	}

	const method = Reflect.get(baseProvider, name);
	if (typeof method !== "function") {
		return;
	}

	Reflect.set(target, name, method.bind(baseProvider));
}
export type { MentionedSkill };

export function buildSkillAutocompleteItems(skillMap: Map<string, string>): AutocompleteItem[] {
	const items: AutocompleteItem[] = [];
	for (const [name, path] of skillMap) {
		items.push({
			value: `$${name}`,
			label: `$${name}`,
			description: path,
		});
	}
	return items;
}

export function collectDiscoveredSkills(commands: SlashCommandInfo[]): Map<string, string> {
	const skills = new Map<string, string>();
	for (const cmd of commands) {
		const skillPath = cmd.sourceInfo?.path;
		if (cmd.source !== "skill" || !skillPath) {
			continue;
		}

		const name = normalizeSkillName(cmd.name);
		if (!name || skills.has(name)) {
			continue;
		}

		skills.set(name, skillPath);
	}
	return skills;
}

export function collectMentionedSkills(
	text: string,
	skillMap: Map<string, string>,
): MentionedSkill[] {
	const names = new Set<string>();
	const skills: MentionedSkill[] = [];
	for (const match of text.matchAll(MENTION_GLOBAL_PATTERN)) {
		const name = match[1];
		if (!name || names.has(name)) {
			continue;
		}

		const path = skillMap.get(name);
		if (!path) {
			continue;
		}

		names.add(name);
		skills.push({ name, path });
	}
	return skills;
}

export function createMentionAutocompleteProvider(
	baseProvider: AutocompleteProvider,
	getSkillItems: () => AutocompleteItem[],
): AutocompleteProvider {
	const provider: AutocompleteProvider = {
		async getSuggestions(...args: AutocompleteArgs) {
			const suggestions = findMentionSuggestions(args, getSkillItems);
			if (suggestions) {
				return suggestions;
			}

			const [lines, cursorLine, cursorCol, options] = args;
			const nextOptions = {
				signal: options?.signal ?? AbortSignal.abort(),
				...(options?.force === undefined ? {} : { force: options.force }),
			};
			return baseProvider.getSuggestions(lines, cursorLine, cursorCol, nextOptions);
		},

		applyCompletion(...args: CompletionArgs) {
			const prefix = args[4];
			if (!prefix.startsWith("$")) {
				return baseProvider.applyCompletion(...args);
			}

			return applyMentionCompletion(args);
		},
	};

	copyOptionalMethod(provider, baseProvider, "getForceFileSuggestions");
	copyOptionalMethod(provider, baseProvider, "shouldTriggerFileCompletion");
	return provider;
}

export function findMentionTokenAtCursor(
	line: string,
	cursorCol: number,
): { token: string; query: string } | null {
	const beforeCursor = line.slice(0, cursorCol);
	const match = beforeCursor.match(MENTION_TOKEN_PATTERN);
	if (!match) {
		return null;
	}

	const query = match[1];
	if (query === undefined) {
		return null;
	}

	return { token: `$${query}`, query };
}
