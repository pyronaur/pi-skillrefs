import {
	type SkillInjectionMode as SkillInjectionModeType,
	type SkillrefsContextBlock,
	skillrefsRefInjection,
} from "./SkillrefsRefInjection.js";
export type SkillInjectionMode = SkillInjectionModeType;

export class SkillrefsContextMessage {
	readonly skills: SkillrefsContextBlock[];
	private readonly content: string;
	private readonly skillContent: string[];

	constructor(skills: SkillrefsContextBlock[]) {
		const message = skillrefsRefInjection.context.create(skills);
		this.skills = message.blocks;
		this.skillContent = message.toBlockContent();
		this.content = message.toString();
	}

	static create(skills: SkillrefsContextBlock[]): SkillrefsContextMessage {
		return new SkillrefsContextMessage(skills);
	}

	static parse(content: unknown): SkillrefsContextMessage | null {
		const message = skillrefsRefInjection.context.parse(content);
		return message ? new SkillrefsContextMessage(message.blocks) : null;
	}

	toSkillContent(): string[] {
		return this.skillContent;
	}

	toString(): string {
		return this.content;
	}
}
