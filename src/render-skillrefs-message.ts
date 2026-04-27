import { keyText, type MessageRenderer } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import {
	SKILL_REMINDER_SUMMARY_TITLE,
	SKILL_SUMMARY_TITLE,
	SKILLREFS_COLLAPSED_VISIBLE_SKILLS,
	SKILLREFS_EXPAND_FALLBACK,
} from "./config/constants.js";
import { TEMPLATE } from "./config/templates.js";
import {
	SkillrefsCustomMessages,
	type SkillrefsMessageDetails,
	type SkillrefsMessageSkill,
} from "./models/SkillrefsCustomMessage.js";

function getExpandKey(): string {
	return keyText("app.tools.expand") || SKILLREFS_EXPAND_FALLBACK;
}

function getTextContent(content: string | { type: string; text?: string }[]): string {
	if (typeof content === "string") {
		return content;
	}

	return content
		.filter((item) => item.type === "text")
		.map((item) => item.text ?? "")
		.join("\n");
}

function formatTokenCount(tokens: number): string {
	if (tokens < 1000) {
		return `${tokens}`;
	}

	return `${(tokens / 1000).toFixed(2).replace(/\.0+$/, "").replace(/(\.\d*[1-9])0$/, "$1")}k`;
}

function formatSkillLine(
	skill: SkillrefsMessageSkill,
	theme: Parameters<MessageRenderer>[2],
): string {
	const title = skill.mode === "reminder"
		? SKILL_REMINDER_SUMMARY_TITLE
		: SKILL_SUMMARY_TITLE;
	return theme.fg("customMessageLabel", title)
		+ theme.fg(
			"customMessageText",
			` ${TEMPLATE.skillSummary(skill.label, formatTokenCount(skill.tokenCount))}`,
		);
}

function buildCollapsedText(
	skills: SkillrefsMessageSkill[],
	theme: Parameters<MessageRenderer>[2],
): string {
	const expandHint = theme.fg("dim", TEMPLATE.expandHint(getExpandKey()));
	if (skills.length === 0) {
		return expandHint;
	}

	const visibleSkills = skills.slice(0, SKILLREFS_COLLAPSED_VISIBLE_SKILLS);
	return [...visibleSkills.map((skill) => formatSkillLine(skill, theme)), expandHint].join("\n");
}

function buildExpandedText(
	content: string,
	skills: SkillrefsMessageSkill[],
	theme: Parameters<MessageRenderer>[2],
): string {
	if (skills.length === 0) {
		return theme.fg("customMessageText", content);
	}

	return TEMPLATE.expandedSkillSummaries(
		skills.map((skill) => formatSkillLine(skill, theme)),
		theme.fg("customMessageText", content),
	);
}

export const renderSkillrefsMessage: MessageRenderer<SkillrefsMessageDetails> = (
	message,
	{ expanded },
	theme,
) => {
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	const content = SkillrefsCustomMessages.expandedContent(
		getTextContent(message.content),
		message.details,
	);
	const skills = SkillrefsCustomMessages.skills(message.details);
	const text = expanded
		? buildExpandedText(content, skills, theme)
		: buildCollapsedText(skills, theme);
	box.addChild(new Text(text, 0, 0));
	return box;
};
