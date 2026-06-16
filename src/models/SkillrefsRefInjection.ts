import type { ContextEvent, MessageRenderer, SessionEntry } from "@earendil-works/pi-coding-agent";
import { keyText } from "@earendil-works/pi-coding-agent";
import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { color } from "../colors.js";
import {
	SKILLREFS_EXPAND_FALLBACK,
	SKILLREFS_REFERENCED_TITLE,
} from "../config/constants.js";
import { TEMPLATE } from "../config/templates.js";
import type { RefOccurrenceInput } from "../ref-injection/RefInjectionAdapter.js";
import type {
	RefInjectionContextBlock,
} from "../ref-injection/RefInjectionContextMessage.js";
import type {
	RefInjectionCustomMessage,
	RefInjectionDetails,
	RefInjectionItem,
} from "../ref-injection/RefInjectionCustomMessage.js";
import {
	createRefInjectionDomain,
	type RefInjectionDomain,
} from "../ref-injection/RefInjectionDomain.js";

const SKILLREFS_CUSTOM_TYPE = "pi-skillrefs";
const ANSI_DIM = "\x1b[2m";
const ANSI_DIM_RESET = "\x1b[22m";
const LOOSE_OBJECT = { additionalProperties: true };
const SKILL_REF_PATTERN = /(?:^|(?<=\s))\$([a-zA-Z][a-zA-Z0-9\-_]*)/gu;

type RendererTheme = Parameters<MessageRenderer>[2];

export type SkillInjectionMode = Static<typeof SkillInjectionModeSchema>;
export type SkillrefsMessageSkill = Static<typeof SkillrefsMessageSkillSchema> & RefInjectionItem;
export type SkillrefsMessageDetails =
	& Static<typeof SkillrefsMessageDetailsSchema>
	& RefInjectionDetails<SkillrefsMessageSkill>;
export type SkillrefsCustomMessage = RefInjectionCustomMessage<
	typeof SKILLREFS_CUSTOM_TYPE,
	SkillrefsMessageSkill
>;
export type SkillrefsContextBlock = RefInjectionContextBlock;
export type SkillrefsRenderBuildContext = {
	buildSkillrefsCustomMessage(
		text: string,
		fullSkillRefs: Set<string>,
	): Promise<SkillrefsCustomMessage | undefined>;
};

type ContextMessage = ContextEvent["messages"][number];

type SkillrefsDomain = RefInjectionDomain<
	ContextMessage,
	SessionEntry,
	typeof SKILLREFS_CUSTOM_TYPE,
	SkillrefsMessageSkill,
	SkillrefsMessageDetails,
	SkillrefsContextBlock,
	SkillrefsRenderBuildContext
>;

export type SkillrefsBranchRefInjectionState = ReturnType<SkillrefsDomain["state"]["empty"]>;
export type SkillrefsBranchRefInjectionTurn = ReturnType<SkillrefsDomain["provider"]["beginTurn"]>;

function getExpandKey(): string {
	return keyText("app.tools.expand") || SKILLREFS_EXPAND_FALLBACK;
}

function textFromUserMessage(message: ContextMessage): string | undefined {
	if (message.role !== "user") {
		return undefined;
	}
	if (typeof message.content === "string") {
		return message.content;
	}

	const text = message.content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
	return text || undefined;
}

function userMessageFromText(text: string): ContextMessage {
	return {
		role: "user",
		content: text,
		timestamp: Date.now(),
	};
}

function skillrefsInputFromText(text: string): RefOccurrenceInput | undefined {
	const refs = new Set<string>();
	for (const match of text.matchAll(SKILL_REF_PATTERN)) {
		const name = match[1];
		if (name) {
			refs.add(`$${name}`);
		}
	}

	return refs.size === 0 ? undefined : { text, refs: [...refs] };
}

function skillrefsInputFromMessage(message: ContextMessage): RefOccurrenceInput | undefined {
	const text = textFromUserMessage(message);
	return text ? skillrefsInputFromText(text) : undefined;
}

function textFromSessionEntry(entry: SessionEntry): string | undefined {
	if (entry.type !== "message") {
		return undefined;
	}

	return textFromUserMessage(entry.message);
}

function renderSkill(
	skill: SkillrefsContextBlock,
	escapeAttribute: (text: string) => string,
): string {
	if (skill.mode === "reminder" && skill.path) {
		return TEMPLATE.injectedSkillReminder(
			escapeAttribute(skill.ref),
			escapeAttribute(skill.path),
		);
	}

	return TEMPLATE.injectedSkill(
		escapeAttribute(skill.ref),
		escapeAttribute(skill.path ?? ""),
		skill.body,
	);
}

function inferSkillInjectionMode(
	ref: string,
	body: string,
	path: string | undefined,
): SkillInjectionMode {
	if (path === undefined) {
		return "full";
	}
	if (body !== TEMPLATE.skillReminder(ref)) {
		return "full";
	}

	return "reminder";
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function legacyFullRefs(details: unknown): string[] {
	if (!isRecord(details) || !Array.isArray(details.skills)) {
		return [];
	}

	return details.skills.flatMap((skill) => {
		if (!isRecord(skill) || skill.mode !== "full" || typeof skill.ref !== "string") {
			return [];
		}

		return [skill.ref];
	});
}

function skillrefsFullRefs(details: unknown, items: SkillrefsMessageSkill[]): string[] {
	const refs = new Set(items
		.filter((item) => item.mode === "full")
		.map((item) => item.ref));
	for (const ref of legacyFullRefs(details)) {
		refs.add(ref);
	}

	return [...refs];
}

function dimText(text: string, theme: RendererTheme | undefined): string {
	return `${ANSI_DIM}${color.textMuted.fg(text, theme)}${ANSI_DIM_RESET}`;
}

const SkillInjectionModeSchema = Type.Union([
	Type.Literal("full"),
	Type.Literal("reminder"),
]);

const SkillrefsMessageSkillSchema = Type.Object(
	{
		ref: Type.String(),
		label: Type.String(),
		tokenCount: Type.Number(),
		path: Type.String(),
		mode: SkillInjectionModeSchema,
	},
	LOOSE_OBJECT,
);

const SkillrefsMessageDetailsSchema = Type.Object(
	{
		skills: Type.Optional(Type.Array(SkillrefsMessageSkillSchema)),
		injectedContent: Type.Optional(Type.String()),
	},
	LOOSE_OBJECT,
);

export const skillrefsRefInjection: SkillrefsDomain = createRefInjectionDomain({
	adapter: {
		occurrenceFromText: skillrefsInputFromText,
		occurrenceFromMessage: skillrefsInputFromMessage,
		textFromUserMessage,
		userMessageFromText,
		textFromBranchEntry: textFromSessionEntry,
		branchEntryHasContextMessage: (entry) =>
			entry.type === "message" || entry.type === "custom_message",
		branchEntryId: (entry) => entry.id,
		compactionFirstKeptEntryId: (entry) =>
			entry.type === "compaction" ? entry.firstKeptEntryId : undefined,
	},
	customMessage: {
		customType: SKILLREFS_CUSTOM_TYPE,
		itemKey: "skills",
		isItem: (value): value is SkillrefsMessageSkill => Check(SkillrefsMessageSkillSchema, value),
		fullRefs: skillrefsFullRefs,
	},
	contextMessage: {
		blockTag: "skill",
		blockTagAliases: ["injected_skill"],
		environmentContext: (content) => TEMPLATE.environmentContext(content),
		renderBlock: renderSkill,
		blockFromAttributes(input): SkillrefsContextBlock | undefined {
			const ref = input.attributes.get("ref");
			if (!ref) {
				return undefined;
			}

			const path = input.attributes.get("path");
			return {
				ref,
				body: input.body,
				mode: inferSkillInjectionMode(ref, input.body, path),
				...(path === undefined ? {} : { path }),
			};
		},
	},
	renderer: {
		summaryTitle: SKILLREFS_REFERENCED_TITLE,
		getExpandKey,
		boxBackground: color.container.bg,
		messageText: color.text.fg,
		dimText,
		itemLine: ({ item, formatTokenCount, theme }) =>
			color.tag.fg(item.ref, theme)
			+ color.text.fg(
				` ${TEMPLATE.skillReferenceTokenCount(formatTokenCount(item.tokenCount))}`,
				theme,
			),
		expandHint: (expandKey) => TEMPLATE.expandHint(expandKey),
		expandedSummary: ({ itemLines, content }) =>
			TEMPLATE.expandedSkillSummaries(itemLines, content),
	},
	buildMessage: (input) =>
		input.buildContext.buildSkillrefsCustomMessage(input.text, input.fullRefs),
});
