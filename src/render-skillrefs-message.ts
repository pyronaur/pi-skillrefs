import { keyText, type MessageRenderer } from "@mariozechner/pi-coding-agent";
import { Box, Text } from "@mariozechner/pi-tui";
import type { InjectedSkillDetails } from "./injected-skill-message.js";

type SkillrefsMessageDetails = {
	skill?: InjectedSkillDetails;
};

function getExpandKey(): string {
	return keyText("app.tools.expand") || "Ctrl+O";
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
	skill: InjectedSkillDetails,
	theme: Parameters<MessageRenderer>[2],
): string {
	const title = skill.mode === "reminder" ? "Skill reminder:" : "Skill:";
	return theme.fg("customMessageLabel", title)
		+ theme.fg("customMessageText",
			` ${skill.label} (${formatTokenCount(skill.tokenCount)} tokens)`);
}

function buildCollapsedText(
	skill: InjectedSkillDetails | undefined,
	theme: Parameters<MessageRenderer>[2],
): string {
	if (!skill) {
		return theme.fg("dim", `(${getExpandKey()} to expand)`);
	}

	return [formatSkillLine(skill, theme), theme.fg("dim", `(${getExpandKey()} to expand)`)].join(
		"\n",
	);
}

function buildExpandedText(
	content: string,
	skill: InjectedSkillDetails | undefined,
	theme: Parameters<MessageRenderer>[2],
): string {
	if (!skill) {
		return theme.fg("customMessageText", content);
	}

	return `${formatSkillLine(skill, theme)}\n\n${theme.fg("customMessageText", content)}`;
}

export const renderSkillrefsMessage: MessageRenderer<SkillrefsMessageDetails> = (
	message,
	{ expanded },
	theme,
) => {
	const box = new Box(1, 1, (text) => theme.bg("customMessageBg", text));
	const content = getTextContent(message.content);
	const skill = message.details?.skill;
	const text = expanded
		? buildExpandedText(content, skill, theme)
		: buildCollapsedText(skill, theme);
	box.addChild(new Text(text, 0, 0));
	return box;
};
