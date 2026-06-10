import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";
import type { RefInjectionItem } from "./RefInjectionCustomMessage.js";

type RendererTheme = Parameters<MessageRenderer>[2];
type RichTextBlock = { type: string; text?: string };
type RenderableRefInjectionMessage<TDetails> = {
	content: string | RichTextBlock[];
	details?: TDetails;
};

export type RefInjectionMessageRendererConfig<TItem extends RefInjectionItem> = {
	visibleItems: number;
	getExpandKey(): string;
	items(details: unknown): TItem[];
	expandedContent(content: string, details: unknown): string;
	boxBackground(text: string, theme: RendererTheme | undefined): string;
	messageText(text: string, theme: RendererTheme | undefined): string;
	dimText(text: string, theme: RendererTheme | undefined): string;
	itemLine(input: {
		item: TItem;
		formatTokenCount: (tokens: number) => string;
		theme: RendererTheme | undefined;
	}): string;
	expandHint(expandKey: string): string;
	expandedSummary(input: { itemLines: string[]; content: string }): string;
};

export type RefInjectionMessageRenderer<TDetails> = {
	renderComponent(
		message: RenderableRefInjectionMessage<TDetails>,
		expanded: boolean,
		theme?: RendererTheme,
	): Box;
	renderMessage: MessageRenderer<TDetails>;
};

type ExpandedTextInput<TItem extends RefInjectionItem> = {
	config: RefInjectionMessageRendererConfig<TItem>;
	content: string;
	items: TItem[];
	theme: RendererTheme | undefined;
};

function getTextContent(content: string | RichTextBlock[]): string {
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

	return `${(tokens / 1000).toFixed(2).replace(/\.0+$/u, "").replace(/(\.\d*[1-9])0$/u, "$1")}k`;
}

function collapsedText<TItem extends RefInjectionItem>(
	config: RefInjectionMessageRendererConfig<TItem>,
	items: TItem[],
	theme: RendererTheme | undefined,
): string {
	const expandHint = config.dimText(config.expandHint(config.getExpandKey()), theme);
	if (items.length === 0) {
		return expandHint;
	}

	const visibleItems = items.slice(0, config.visibleItems);
	return [
		...visibleItems.map((item) => config.itemLine({ item, formatTokenCount, theme })),
		expandHint,
	].join("\n");
}

function expandedText<TItem extends RefInjectionItem>(input: ExpandedTextInput<TItem>): string {
	const renderedContent = input.config.messageText(input.content, input.theme);
	if (input.items.length === 0) {
		return renderedContent;
	}

	return input.config.expandedSummary({
		itemLines: input.items.map((item) =>
			input.config.itemLine({ item, formatTokenCount, theme: input.theme })
		),
		content: renderedContent,
	});
}

export function createRefInjectionMessageRenderer<
	TDetails,
	TItem extends RefInjectionItem,
>(
	config: RefInjectionMessageRendererConfig<TItem>,
): RefInjectionMessageRenderer<TDetails> {
	function renderComponent(
		message: RenderableRefInjectionMessage<TDetails>,
		expanded: boolean,
		theme?: RendererTheme,
	): Box {
		const box = new Box(1, 1, (text) => config.boxBackground(text, theme));
		const content = config.expandedContent(getTextContent(message.content), message.details);
		const items = config.items(message.details);
		const text = expanded
			? expandedText({ config, content, items, theme })
			: collapsedText(config, items, theme);
		box.addChild(new Text(text, 0, 0));
		return box;
	}

	return {
		renderComponent,
		renderMessage: (message, { expanded }, theme) => renderComponent(message, expanded, theme),
	};
}
