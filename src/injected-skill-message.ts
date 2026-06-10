import {
	estimateTokens,
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
type BuildInjectedSkillMessageOptions = {
	fullSkillRefs: ReadonlySet<string>;
};

const H1_PATTERN = /^#\s+(.+?)\s*$/m;
const FRONTMATTER_PATTERN = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/u;

type InjectedSkillBlock = SkillrefsMessageSkill & { body: string };

function resolveSkillLabel(skill: MentionedSkill, content: string): string {
	const body = stripSkillFrontmatter(content);
	const heading = body.match(H1_PATTERN)?.[1]?.trim();
	if (heading) {
		return heading;
	}

	return `$${skill.name}`;
}

function stripSkillFrontmatter(content: string): string {
	return content.replace(FRONTMATTER_PATTERN, "");
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
		const resolvedSkillPath = resolve(resolvedPath);
		const ref = `$${skill.name}`;
		const body = mode === "reminder"
			? TEMPLATE.skillReminder(ref)
			: stripSkillFrontmatter(raw).trimEnd();
		const block = { ref, body, path: resolvedSkillPath, mode };
		const content = SkillrefsContextMessage.create([block]).toSkillContent()[0] ?? "";
		return {
			...block,
			label: resolveSkillLabel(skill, raw),
			tokenCount: estimateTokens({
				role: "custom",
				customType: SkillrefsCustomMessages.type,
				content,
				display: true,
				timestamp: 0,
			}),
		};
	} catch {
		return undefined;
	}
}

export async function buildInjectedSkillMessage(
	text: string,
	skillMap: Map<string, string>,
	options: BuildInjectedSkillMessageOptions,
): Promise<InjectedSkillMessage | undefined> {
	const skills = collectMentionedSkills(text, skillMap);
	if (skills.length === 0) {
		return undefined;
	}

	const blocks = (await Promise.all(
		skills.map((skill) => {
			const mode: SkillInjectionMode = options.fullSkillRefs.has(`$${skill.name}`)
				? "reminder"
				: "full";
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
