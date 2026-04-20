import { TEMPLATE } from "../config/templates.js";

type SkillrefsContextBlockInput = {
	ref: string;
	body: string;
	path?: string;
	mode: "full" | "reminder";
};

const ENVIRONMENT_CONTEXT_PATTERN =
	/^\s*<environment_context>\s*([\s\S]*?)\s*<\/environment_context>\s*$/u;
const INJECTED_SKILL_PATTERN = /<injected_skill\b([^>]*)>([\s\S]*?)<\/injected_skill>/gu;
const ATTRIBUTE_PATTERN = /\b([a-z_]+)="([^"]*)"/gu;

function escapeXmlAttribute(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("\"", "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("'", "&apos;");
}

function unescapeXmlAttribute(text: string): string {
	return text
		.replaceAll("&quot;", "\"")
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&apos;", "'")
		.replaceAll("&amp;", "&");
}

function readAttributes(raw: string): Record<string, string> {
	const attrs: Record<string, string> = {};
	for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
		const [, key, value] = match;
		if (!key) {
			continue;
		}

		attrs[key] = unescapeXmlAttribute(value ?? "");
	}

	return attrs;
}

function trimBody(body: string): string {
	return body.replaceAll("\r\n", "\n").replace(/^\n+|\n+$/gu, "");
}

type SkillrefsContextBlock = {
	ref: string;
	body: string;
	path?: string;
	mode: "full" | "reminder";
};

export class SkillrefsContextMessage {
	readonly skills: SkillrefsContextBlock[];

	constructor(skills: SkillrefsContextBlockInput[]) {
		this.skills = skills.map((skill) => ({
			ref: skill.ref,
			body: trimBody(skill.body),
			mode: skill.mode,
			...(skill.path === undefined ? {} : { path: skill.path }),
		}));
	}

	static create(skills: SkillrefsContextBlockInput[]): SkillrefsContextMessage {
		return new SkillrefsContextMessage(skills);
	}

	static parse(content: unknown): SkillrefsContextMessage | null {
		if (typeof content !== "string") {
			return null;
		}

		const match = ENVIRONMENT_CONTEXT_PATTERN.exec(content);
		if (!match) {
			return null;
		}

		const [, body = ""] = match;
		const skills: SkillrefsContextBlock[] = [];
		for (const blockMatch of body.matchAll(INJECTED_SKILL_PATTERN)) {
			const [, rawAttrs = "", rawBody = ""] = blockMatch;
			const attrs = readAttributes(rawAttrs);
			const ref = attrs.ref;
			if (!ref) {
				continue;
			}

			skills.push({
				ref,
				body: trimBody(rawBody),
				mode: attrs.path !== undefined && trimBody(rawBody) === TEMPLATE.skillReminder(ref)
					? "reminder"
					: "full",
				...(attrs.path === undefined ? {} : { path: attrs.path }),
			});
		}

		if (skills.length === 0) {
			return null;
		}

		return new SkillrefsContextMessage(skills);
	}

	toString(): string {
		const body = this.skills.map((skill) => {
			if (skill.mode === "reminder" && skill.path) {
				return TEMPLATE.injectedSkillReminder(
					escapeXmlAttribute(skill.ref),
					escapeXmlAttribute(skill.path),
				);
			}

			return TEMPLATE.injectedSkill(
				escapeXmlAttribute(skill.ref),
				escapeXmlAttribute(skill.path ?? ""),
				skill.body,
			);
		}).join("\n\n");

		return TEMPLATE.environmentContext(body);
	}
}
