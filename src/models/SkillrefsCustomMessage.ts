import {
	type SkillrefsCustomMessage,
	type SkillrefsMessageSkill,
	skillrefsRefInjection,
} from "./SkillrefsRefInjection.js";
export type {
	SkillrefsCustomMessage,
	SkillrefsMessageDetails,
	SkillrefsMessageSkill,
} from "./SkillrefsRefInjection.js";

export const SkillrefsCustomMessages = {
	type: skillrefsRefInjection.message.type,
	create: (content: string, skills: SkillrefsMessageSkill[]): SkillrefsCustomMessage =>
		skillrefsRefInjection.message.create(content, skills),
	is: (message: unknown): message is SkillrefsCustomMessage =>
		skillrefsRefInjection.message.is(message),
	fullRefs: (message: unknown): string[] => skillrefsRefInjection.message.fullRefs(message),
	restoreContent: <TMessage>(message: TMessage): TMessage =>
		skillrefsRefInjection.message.restoreContent(message),
	expandedContent: (content: string, details: unknown): string =>
		skillrefsRefInjection.message.expandedContent(content, details),
	skills: (details: unknown): SkillrefsMessageSkill[] =>
		skillrefsRefInjection.message.items(details),
};
