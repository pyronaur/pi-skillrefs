import {
	buildSessionContext,
	estimateTokens,
	parseFrontmatter,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import { readFile, realpath } from "node:fs/promises";
import { resolve } from "node:path";
import { TEMPLATE } from "./config/templates.js";
import {
	type SkillInjectionMode,
	SkillrefsContextMessage,
} from "./models/skillrefs-context-message.js";
import {
	SkillrefsCustomMessages,
	type SkillrefsMessageSkill,
} from "./models/SkillrefsCustomMessage.js";
import { collectMentionedSkills, type MentionedSkill } from "./utils.js";

type InjectedSkillMessage = {
	content: string;
	skills: SkillrefsMessageSkill[];
};

const H1_PATTERN = /^#\s+(.+?)\s*$/m;

type SkillRefsSessionManager = {
	getEntries(): SessionEntry[];
	getLeafId(): string | null;
};

type InjectedSkillBlock = SkillrefsMessageSkill & { body: string };

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
		customType: SkillrefsCustomMessages.type,
		content,
		display: true,
		timestamp: 0,
	});
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
		for (const ref of SkillrefsCustomMessages.fullRefs(message)) {
			refs.add(ref);
		}
	}

	return refs;
}

async function readInjectedSkillBlock(
	skill: MentionedSkill,
	mode: SkillInjectionMode,
): Promise<InjectedSkillBlock | undefined> {
	try {
		const [raw, resolvedPath] = await Promise.all([
			readFile(skill.path, "utf8"),
			realpath(skill.path),
		]);
		const path = resolve(resolvedPath);
		const ref = `$${skill.name}`;
		const body = mode === "reminder" ? TEMPLATE.skillReminder(ref) : resolveInjectedSkillBody(raw);
		const block = { ref, body, path, mode };
		const content = SkillrefsContextMessage.create([block]).toSkillContent()[0] ?? "";
		return {
			...block,
			label: resolveSkillLabel(skill, raw),
			tokenCount: estimateSkillTokens(content),
		};
	} catch {
		return undefined;
	}
}

export async function buildInjectedSkillMessage(
	text: string,
	skillMap: Map<string, string>,
	sessionManager?: SkillRefsSessionManager,
): Promise<InjectedSkillMessage | undefined> {
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

	const content = SkillrefsContextMessage.create(blocks).toString();
	return {
		content,
		skills: blocks.map((block) => ({
			ref: block.ref,
			label: block.label,
			tokenCount: block.tokenCount,
			path: block.path,
			mode: block.mode,
		})),
	};
}
