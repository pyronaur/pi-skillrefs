import { type Static, Type } from "typebox";
import { Check } from "typebox/value";
import { SkillInjectionMode } from "./skillrefs-context-message.js";

const SKILLREFS_CUSTOM_TYPE = "pi-skillrefs";
const LOOSE_OBJECT = { additionalProperties: true };

const SkillrefsFullRefDetails = Type.Object(
	{
		skills: Type.Optional(Type.Array(Type.Object(
			{ ref: Type.String(), mode: SkillInjectionMode },
			LOOSE_OBJECT,
		))),
	},
	LOOSE_OBJECT,
);

const SkillrefsSessionMessageSchema = Type.Object(
	{
		role: Type.Literal("custom"),
		customType: Type.Literal(SKILLREFS_CUSTOM_TYPE),
		content: Type.String(),
		details: Type.Optional(Type.Object(
			{ injectedContent: Type.Optional(Type.String()) },
			LOOSE_OBJECT,
		)),
	},
	LOOSE_OBJECT,
);

type SkillrefsSessionMessage = Static<typeof SkillrefsSessionMessageSchema>;

export class SkillrefsCustomMessages {
	static readonly type = SKILLREFS_CUSTOM_TYPE;

	static create(content: string, skills: SkillrefsMessageSkill[]): SkillrefsCustomMessage {
		return {
			customType: SkillrefsCustomMessages.type,
			content: skills.map((skill) => skill.ref).join(", "),
			display: true,
			details: { skills, injectedContent: content },
		};
	}

	static is(message: unknown): message is SkillrefsSessionMessage {
		return Check(SkillrefsSessionMessageSchema, message);
	}

	static skills(details: unknown): SkillrefsMessageSkill[] {
		return Check(SkillrefsMessageDetails, details) ? details.skills ?? [] : [];
	}

	static fullRefs(message: unknown): string[] {
		if (!SkillrefsCustomMessages.is(message)) {
			return [];
		}

		if (!Check(SkillrefsFullRefDetails, message.details)) {
			return [];
		}

		return (message.details?.skills ?? [])
			.filter((skill) => skill.mode === "full")
			.map((skill) => skill.ref);
	}

	static restoreContent<TMessage>(message: TMessage): TMessage {
		if (SkillrefsCustomMessages.is(message) && message.details?.injectedContent) {
			return { ...message, content: message.details.injectedContent };
		}

		return message;
	}

	static expandedContent(content: string, details: unknown): string {
		return Check(SkillrefsMessageDetails, details)
			? details.injectedContent ?? content
			: content;
	}
}

export const SkillrefsMessageSkill = Type.Object(
	{
		ref: Type.String(),
		label: Type.String(),
		tokenCount: Type.Number(),
		path: Type.String(),
		mode: SkillInjectionMode,
	},
	LOOSE_OBJECT,
);

export const SkillrefsMessageDetails = Type.Object(
	{
		skills: Type.Optional(Type.Array(SkillrefsMessageSkill)),
		injectedContent: Type.Optional(Type.String()),
	},
	LOOSE_OBJECT,
);

export const SkillrefsCustomMessage = Type.Object({
	customType: Type.Literal(SKILLREFS_CUSTOM_TYPE),
	content: Type.String(),
	display: Type.Literal(true),
	details: SkillrefsMessageDetails,
});

export type SkillrefsMessageSkill = Static<typeof SkillrefsMessageSkill>;
export type SkillrefsMessageDetails = Static<typeof SkillrefsMessageDetails>;
export type SkillrefsCustomMessage = Static<typeof SkillrefsCustomMessage>;
