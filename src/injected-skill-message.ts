import { readFile } from "node:fs/promises";
import { collectMentionedSkills, type MentionedSkill } from "./utils.js";

function buildInjectedSkillBlock(skill: MentionedSkill, content: string): string {
	const text = content.trimEnd();
	return `<injected_skill ref="$${skill.name}">\n${text}\n</injected_skill>`;
}

async function readInjectedSkillBlock(skill: MentionedSkill): Promise<string | undefined> {
	try {
		const content = await readFile(skill.path, "utf8");
		return buildInjectedSkillBlock(skill, content);
	} catch {
		return undefined;
	}
}

export async function buildInjectedSkillMessage(
	text: string,
	skillMap: Map<string, string>,
): Promise<string | undefined> {
	const skills = collectMentionedSkills(text, skillMap);
	if (skills.length === 0) {
		return undefined;
	}

	const blocks = (await Promise.all(skills.map(readInjectedSkillBlock))).filter((block) =>
		block !== undefined
	);
	if (blocks.length === 0) {
		return undefined;
	}

	return blocks.join("\n\n");
}
