import type { RefInjectionMode } from "./RefInjectionCustomMessage.js";

export type RefInjectionContextBlock = {
	ref: string;
	body: string;
	mode: RefInjectionMode;
	path?: string;
	command?: string;
};

export type RefInjectionContextMessageConfig<TBlock extends RefInjectionContextBlock> = {
	blockTag: string;
	environmentContext(content: string): string;
	renderBlock(block: TBlock, escapeAttribute: (text: string) => string): string;
	blockFromAttributes(input: {
		attributes: ReadonlyMap<string, string>;
		body: string;
	}): TBlock | undefined;
};

const ENVIRONMENT_CONTEXT_PATTERN =
	/^\s*<environment_context>\s*([\s\S]*?)\s*<\/environment_context>\s*$/u;
const ATTRIBUTE_PATTERN = /\b([a-z_]+)="([^"]*)"/gu;

function escapeXmlAttribute(text: string): string {
	return text
		.replaceAll("&", "&amp;")
		.replaceAll("\"", "&quot;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll("'", "&apos;");
}

function readAttributes(raw: string): Map<string, string> {
	const attrs = new Map<string, string>();
	for (const match of raw.matchAll(ATTRIBUTE_PATTERN)) {
		const [, key, value] = match;
		if (key) {
			attrs.set(key, (value ?? "")
				.replaceAll("&quot;", "\"")
				.replaceAll("&lt;", "<")
				.replaceAll("&gt;", ">")
				.replaceAll("&apos;", "'")
				.replaceAll("&amp;", "&"));
		}
	}
	return attrs;
}

function trimBody(body: string): string {
	return body.replaceAll("\r\n", "\n").replace(/^\n+|\n+$/gu, "");
}

export class RefInjectionContextMessage<TBlock extends RefInjectionContextBlock> {
	readonly blocks: TBlock[];
	private readonly config: RefInjectionContextMessageConfig<TBlock>;

	constructor(
		config: RefInjectionContextMessageConfig<TBlock>,
		blocks: readonly TBlock[],
	) {
		this.config = config;
		this.blocks = blocks.map((block) => ({
			...block,
			body: trimBody(block.body),
		}));
	}

	static parse<TBlock extends RefInjectionContextBlock>(
		config: RefInjectionContextMessageConfig<TBlock>,
		content: unknown,
	): RefInjectionContextMessage<TBlock> | null {
		if (typeof content !== "string") {
			return null;
		}

		const match = ENVIRONMENT_CONTEXT_PATTERN.exec(content);
		if (!match) {
			return null;
		}

		const [, body = ""] = match;
		const blocks: TBlock[] = [];
		const pattern = new RegExp(`<${config.blockTag}\\b([^>]*)>([\\s\\S]*?)<\\/${config.blockTag}>`,
			"gu");
		for (const blockMatch of body.matchAll(pattern)) {
			const [, rawAttrs = "", rawBody = ""] = blockMatch;
			const block = config.blockFromAttributes({
				attributes: readAttributes(rawAttrs),
				body: trimBody(rawBody),
			});
			if (block) {
				blocks.push(block);
			}
		}

		return blocks.length === 0 ? null : new RefInjectionContextMessage(config, blocks);
	}

	static create<TBlock extends RefInjectionContextBlock>(
		config: RefInjectionContextMessageConfig<TBlock>,
		blocks: readonly TBlock[],
	): RefInjectionContextMessage<TBlock> {
		return new RefInjectionContextMessage(config, blocks);
	}

	toBlockContent(): string[] {
		return this.blocks.map((block) => this.config.renderBlock(block, escapeXmlAttribute));
	}

	toString(): string {
		return this.config.environmentContext(this.toBlockContent().join("\n\n"));
	}
}
