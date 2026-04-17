import {
	buildSessionContext,
	estimateTokens,
	parseFrontmatter,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { collectMentionedSkills, type MentionedSkill } from "./utils.js";

type SkillInjectionMode = "full" | "reminder";

export type InjectedSkillDetails = {
	ref: string;
	label: string;
	tokenCount: number;
	path: string;
	mode: SkillInjectionMode;
};

type InjectedSkillMessage = {
	content: string;
	skill: InjectedSkillDetails;
};

const H1_PATTERN = /^#\s+(.+?)\s*$/m;

type SkillRefsSessionManager = {
	getEntries(): SessionEntry[];
	getLeafId(): string | null;
};

type SkillRefsMessageRecord = Record<string, unknown>;

function buildInjectedSkillBlock(skill: MentionedSkill, content: string): string {
	const text = content.trimEnd();
	return `<injected_skill ref="$${skill.name}">\n${text}\n</injected_skill>`;
}

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
}

function buildReminderInjectedSkillBlock(skill: MentionedSkill): string {
	const path = escapeAttribute(resolve(skill.path));
	return `<injected_skill ref="$${skill.name}" path="${path}">Reminder to use $${skill.name}</injected_skill>`;
}

function resolveSkillLabel(skill: MentionedSkill, content: string): string {
	const { body } = parseFrontmatter(content);
	const heading = body.match(H1_PATTERN)?.[1]?.trim();
	if (heading) {
		return heading;
	}

	return `$${skill.name}`;
}

function estimateSkillTokens(content: string): number {
	return estimateTokens({
		role: "custom",
		customType: "skillrefs",
		content,
		display: true,
		timestamp: 0,
	});
}

function isObject(value: unknown): value is SkillRefsMessageRecord {
	return typeof value === "object" && value !== null;
}

function extractLegacyFullSkillRef(content: string): string | undefined {
	const match = content.match(/^<injected_skill\s+ref=(?:"([^"]+)"|([^\s>]+))>/);
	if (!match) {
		return undefined;
	}
	if (content.includes(" path=")) {
		return undefined;
	}

	return match[1] ?? match[2];
}

function getInjectedSkillRef(message: unknown): string | undefined {
	if (!isObject(message)) {
		return undefined;
	}
	if (message.role !== "custom" || message.customType !== "skillrefs") {
		return undefined;
	}

	const details = isObject(message.details) ? message.details : undefined;
	const skill = details && isObject(details.skill) ? details.skill : undefined;
	if (skill?.mode === "full" && typeof skill.ref === "string") {
		return skill.ref;
	}

	if (typeof message.content !== "string") {
		return undefined;
	}

	return extractLegacyFullSkillRef(message.content);
}

function collectFullSkillRefs(sessionManager?: SkillRefsSessionManager): Set<string> {
	if (!sessionManager) {
		return new Set();
	}

	const entries = sessionManager.getEntries();
	const leafId = sessionManager.getLeafId();
	const context = buildSessionContext(entries, leafId).messages;
	const refs = new Set<string>();
	for (const message of context) {
		const ref = getInjectedSkillRef(message);
		if (!ref) {
			continue;
		}

		refs.add(ref);
	}

	return refs;
}

async function readInjectedSkillBlock(
	skill: MentionedSkill,
	mode: SkillInjectionMode,
): Promise<(InjectedSkillDetails & { content: string }) | undefined> {
	try {
		const raw = await readFile(skill.path, "utf8");
		const path = resolve(skill.path);
		const block = mode === "reminder"
			? buildReminderInjectedSkillBlock(skill)
			: buildInjectedSkillBlock(skill, raw);
		return {
			ref: `$${skill.name}`,
			label: resolveSkillLabel(skill, raw),
			tokenCount: estimateSkillTokens(block),
			path,
			mode,
			content: block,
		};
	} catch {
		return undefined;
	}
}

export async function buildInjectedSkillMessages(
	text: string,
	skillMap: Map<string, string>,
	sessionManager?: SkillRefsSessionManager,
): Promise<InjectedSkillMessage[] | undefined> {
	const skills = collectMentionedSkills(text, skillMap);
	if (skills.length === 0) {
		return undefined;
	}
	const fullSkillRefs = collectFullSkillRefs(sessionManager);

	const blocks = (await Promise.all(
		skills.map((skill) => {
			const mode: SkillInjectionMode = fullSkillRefs.has(`$${skill.name}`) ? "reminder" : "full";
			return readInjectedSkillBlock(skill, mode);
		}),
	)).filter((block) => block !== undefined);
	if (blocks.length === 0) {
		return undefined;
	}

	return blocks.map(({ content, ...skill }) => ({ content, skill }));
}
