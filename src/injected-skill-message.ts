import {
	buildSessionContext,
	estimateTokens,
	parseFrontmatter,
	type SessionEntry,
} from "@mariozechner/pi-coding-agent";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { SKILLREFS_MESSAGE_TYPE } from "./config/constants.js";
import { TEMPLATE } from "./config/templates.js";
import { SkillrefsContextMessage } from "./models/skillrefs-context-message.js";
import { collectMentionedSkills, type MentionedSkill } from "./utils.js";

export type SkillInjectionMode = "full" | "reminder";

export type InjectedSkillDetails = {
	ref: string;
	label: string;
	tokenCount: number;
	path: string;
	mode: SkillInjectionMode;
};

type InjectedSkillMessage = {
	content: string;
	skills: InjectedSkillDetails[];
};

const H1_PATTERN = /^#\s+(.+?)\s*$/m;

type SkillRefsSessionManager = {
	getEntries(): SessionEntry[];
	getLeafId(): string | null;
};

type SkillRefsMessageRecord = Record<string, unknown>;

function escapeAttribute(value: string): string {
	return value.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
}

function resolveSkillLabel(skill: MentionedSkill, content: string): string {
	const { body } = parseFrontmatter(content);
	const heading = body.match(H1_PATTERN)?.[1]?.trim();
	if (heading) {
		return heading;
	}

	return `$${skill.name}`;
}

function resolveInjectedSkillBody(content: string): string {
	return parseFrontmatter(content).body.trimEnd();
}

function estimateSkillTokens(content: string): number {
	return estimateTokens({
		role: "custom",
		customType: SKILLREFS_MESSAGE_TYPE,
		content,
		display: true,
		timestamp: 0,
	});
}

function isObject(value: unknown): value is SkillRefsMessageRecord {
	return typeof value === "object" && value !== null;
}

function extractLegacyFullSkillRef(content: string): string | undefined {
	const match = content.match(
		/^<injected_skill\s+ref=(?:"([^"]+)"|([^\s>]+))(?:\s+path=(?:"[^"]+"|[^\s>]+))?>\n?([\s\S]*?)<\/injected_skill>$/,
	);
	if (!match) {
		return undefined;
	}

	const ref = match[1] ?? match[2];
	if (!ref) {
		return undefined;
	}
	if (match[3]?.trim() === TEMPLATE.skillReminder(ref)) {
		return undefined;
	}

	return ref;
}

function readFullDetailRefs(details: unknown): string[] {
	if (!isObject(details)) {
		return [];
	}

	if (Array.isArray(details.skills)) {
		return details.skills.flatMap((skill) => {
			if (!isObject(skill)) {
				return [];
			}
			if (skill.mode !== "full" || typeof skill.ref !== "string") {
				return [];
			}

			return [skill.ref];
		});
	}

	const legacySkill = isObject(details.skill) ? details.skill : undefined;
	if (legacySkill?.mode === "full" && typeof legacySkill.ref === "string") {
		return [legacySkill.ref];
	}

	return [];
}

function getInjectedSkillRefs(message: unknown): string[] {
	if (!isObject(message)) {
		return [];
	}
	if (message.role !== "custom" || message.customType !== SKILLREFS_MESSAGE_TYPE) {
		return [];
	}

	const detailRefs = readFullDetailRefs(message.details);
	if (detailRefs.length > 0) {
		return detailRefs;
	}

	if (typeof message.content !== "string") {
		return [];
	}

	const parsed = SkillrefsContextMessage.parse(message.content);
	if (parsed) {
		return parsed.skills
			.filter((skill) => skill.mode === "full")
			.map((skill) => skill.ref);
	}

	const ref = extractLegacyFullSkillRef(message.content);
	return ref ? [ref] : [];
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
		for (const ref of getInjectedSkillRefs(message)) {
			refs.add(ref);
		}
	}

	return refs;
}

async function readInjectedSkillBlock(
	skill: MentionedSkill,
	mode: SkillInjectionMode,
): Promise<(InjectedSkillDetails & { body: string }) | undefined> {
	try {
		const [raw, resolvedPath] = await Promise.all([
			readFile(skill.path, "utf8"),
			realpath(skill.path),
		]);
		const path = resolve(resolvedPath);
		const ref = `$${skill.name}`;
		const body = mode === "reminder" ? TEMPLATE.skillReminder(ref) : resolveInjectedSkillBody(raw);
		const content = mode === "reminder"
			? TEMPLATE.injectedSkillReminder(ref, escapeAttribute(path))
			: TEMPLATE.injectedSkill(ref, escapeAttribute(path), body);
		return {
			ref,
			label: resolveSkillLabel(skill, raw),
			tokenCount: estimateSkillTokens(content),
			path,
			mode,
			body,
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

	const content = SkillrefsContextMessage.create(blocks.map((block) => ({
		ref: block.ref,
		body: block.body,
		path: block.path,
		mode: block.mode,
	}))).toString();
	return [{
		content,
		skills: blocks.map(({ body: _body, ...skill }) => skill),
	}];
}
