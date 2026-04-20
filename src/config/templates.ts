export const TEMPLATE = {
	environmentContext(body: string): string {
		return ["<environment_context>", body, "</environment_context>"].join("\n");
	},
	injectedSkill(ref: string, path: string, body: string): string {
		return [`<injected_skill ref="${ref}" path="${path}">`, body, "</injected_skill>"]
			.join("\n");
	},
	injectedSkillReminder(ref: string, path: string): string {
		return `<injected_skill ref="${ref}" path="${path}">${
			TEMPLATE.skillReminder(ref)
		}</injected_skill>`;
	},
	skillReminder(ref: string): string {
		return `Reminder to use ${ref}`;
	},
	skillSummary(label: string, tokenCount: string): string {
		return `${label} (${tokenCount} tokens)`;
	},
	expandHint(key: string): string {
		return `(${key} to expand)`;
	},
	expandedSkillSummaries(lines: string[], content: string): string {
		if (lines.length === 0) {
			return content;
		}

		return `${lines.join("\n")}\n\n${content}`;
	},
} as const;
