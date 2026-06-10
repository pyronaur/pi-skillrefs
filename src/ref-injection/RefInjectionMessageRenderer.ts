import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import {
	Box,
	type Component,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { RefInjectionItem } from "./RefInjectionCustomMessage.js";

type RendererTheme = Parameters<MessageRenderer>[2];
type RichTextBlock = { type: string; text?: string };
type RenderableRefInjectionMessage<TDetails> = {
	content: string | RichTextBlock[];
	details?: TDetails;
};

export type RefInjectionMessageRendererConfig<TItem extends RefInjectionItem> = {
	summaryTitle: string;
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
	width: number;
};

type SummaryRowsInput<TItem extends RefInjectionItem> = {
	config: RefInjectionMessageRendererConfig<TItem>;
	items: TItem[];
	theme: RendererTheme | undefined;
	width: number;
};

type RefInjectionSummaryComponentInput<TItem extends RefInjectionItem> = {
	config: RefInjectionMessageRendererConfig<TItem>;
	content: string;
	items: TItem[];
	expanded: boolean;
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

function headerLine(left: string, right: string, width: number): string {
	const available = Math.max(1, width);
	const leftWidth = visibleWidth(left);
	const rightWidth = visibleWidth(right);
	const gap = available - leftWidth - rightWidth;
	if (gap > 0) {
		return left + " ".repeat(gap) + right;
	}

	const leftMaxWidth = available - rightWidth - 1;
	if (leftMaxWidth > 0) {
		return truncateToWidth(left, leftMaxWidth, "") + " " + right;
	}

	return truncateToWidth(right, available, "");
}

function summaryRows<TItem extends RefInjectionItem>(
	input: SummaryRowsInput<TItem>,
): string[] {
	const title = input.config.dimText(input.config.summaryTitle, input.theme);
	const hint = input.config.dimText(input.config.expandHint(input.config.getExpandKey()),
		input.theme);
	const header = headerLine(title, hint, input.width);
	const items = input.items.map((item) =>
		input.config.itemLine({ item, formatTokenCount, theme: input.theme })
	).join(" ");
	if (items.length === 0) {
		return [header];
	}

	return [header, ...wrapTextWithAnsi(items, input.width)];
}

function expandedText<TItem extends RefInjectionItem>(input: ExpandedTextInput<TItem>): string[] {
	const renderedContent = input.config.messageText(input.content, input.theme);
	if (input.items.length === 0) {
		return wrapTextWithAnsi(renderedContent, input.width);
	}

	return input.config.expandedSummary({
		itemLines: summaryRows(input),
		content: wrapTextWithAnsi(renderedContent, input.width).join("\n"),
	}).split("\n");
}

class RefInjectionSummaryComponent<TItem extends RefInjectionItem> implements Component {
	private readonly config: RefInjectionMessageRendererConfig<TItem>;
	private readonly content: string;
	private readonly items: TItem[];
	private readonly expanded: boolean;
	private readonly theme: RendererTheme | undefined;

	constructor(input: RefInjectionSummaryComponentInput<TItem>) {
		this.config = input.config;
		this.content = input.content;
		this.items = input.items;
		this.expanded = input.expanded;
		this.theme = input.theme;
	}

	invalidate(): void {}

	render(width: number): string[] {
		const renderWidth = Math.max(1, width);
		return this.expanded
			? expandedText({
				config: this.config,
				content: this.content,
				items: this.items,
				theme: this.theme,
				width: renderWidth,
			})
			: summaryRows({
				config: this.config,
				items: this.items,
				theme: this.theme,
				width: renderWidth,
			});
	}
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
		box.addChild(new RefInjectionSummaryComponent({ config, content, items, expanded, theme }));
		return box;
	}

	return {
		renderComponent,
		renderMessage: (message, { expanded }, theme) => renderComponent(message, expanded, theme),
	};
}
