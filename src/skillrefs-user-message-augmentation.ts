import { InteractiveMode, type MessageRenderer } from "@earendil-works/pi-coding-agent";
import { Box, type Component, Text } from "@earendil-works/pi-tui";
import { SKILLREFS_EXPAND_FALLBACK } from "./config/constants.js";
import { TEMPLATE } from "./config/templates.js";
import type { SkillrefsCustomMessage } from "./models/SkillrefsCustomMessage.js";
import { skillrefsRefInjection } from "./models/SkillrefsRefInjection.js";

type LoadState =
	| { status: "idle" }
	| { status: "loading" }
	| { status: "loaded"; message: SkillrefsCustomMessage }
	| { status: "empty" }
	| { status: "error"; message: string };

type LoadSkillrefsUserMessage = () => Promise<SkillrefsCustomMessage | undefined>;
type SkillrefsUserMessageRenderContext = {
	source: "history" | "live";
};
type RendererTheme = Parameters<MessageRenderer>[2];
type PrepareSkillrefsUserMessage = (
	text: string,
	context: SkillrefsUserMessageRenderContext,
) => LoadSkillrefsUserMessage;

export type SkillrefsUserMessageAugmentationOptions = {
	prepareMessage: PrepareSkillrefsUserMessage;
	refsForText(text: string): string[];
	theme: RendererTheme;
};

type SkillrefsUserMessageComponentOptions = {
	refs: string[];
	expandKey: string;
	loadMessage: LoadSkillrefsUserMessage;
	requestRender: () => void;
	expanded: boolean;
	theme: RendererTheme;
};

type ChatMessage = {
	role?: string;
};

type ChatContainer = {
	addChild(child: Component): void;
};

type InteractiveModeInstance = Record<PropertyKey, unknown>;

function isRecord(value: unknown): value is Record<PropertyKey, unknown> {
	return typeof value === "object" && value !== null;
}

function hasAddChild(value: unknown): value is ChatContainer {
	return (
		isRecord(value)
		&& "addChild" in value
		&& typeof value.addChild === "function"
	);
}

function getUserMessageText(
	host: InteractiveModeInstance,
	message: ChatMessage,
): string | undefined {
	const getUserMessageTextValue = Reflect.get(host, "getUserMessageText");
	if (typeof getUserMessageTextValue !== "function") {
		return undefined;
	}

	const text: unknown = getUserMessageTextValue.call(host, message);
	return typeof text === "string" ? text : undefined;
}

function getKeyText(host: InteractiveModeInstance, keybinding: string): string | undefined {
	const keybindings: unknown = Reflect.get(host, "keybindings");
	if (!isRecord(keybindings)) {
		return undefined;
	}

	const getKeys = Reflect.get(keybindings, "getKeys");
	if (typeof getKeys !== "function") {
		return undefined;
	}

	const keys: unknown = getKeys.call(keybindings, keybinding);
	if (!Array.isArray(keys)) {
		return undefined;
	}

	const firstKey: unknown = keys[0];
	return typeof firstKey === "string" ? firstKey : undefined;
}

function statusText(refs: string[], message: string, theme: RendererTheme): string {
	return [
		theme.fg("customMessageLabel", `Skillrefs: ${refs.join(", ")}`),
		theme.fg("customMessageText", message),
	].join("\n");
}

function renderBox(text: string, theme: RendererTheme): Component {
	const box = new Box(1, 1, (content) => theme.bg("customMessageBg", content));
	box.addChild(new Text(text, 0, 0));
	return box;
}

class SkillrefsUserMessageComponent implements Component {
	private expanded: boolean;
	private loadState: LoadState = { status: "idle" };
	private readonly refs: string[];
	private readonly expandKey: string;
	private readonly loadMessage: LoadSkillrefsUserMessage;
	private readonly requestRender: () => void;
	private readonly theme: RendererTheme;

	constructor(options: SkillrefsUserMessageComponentOptions) {
		this.refs = options.refs;
		this.expandKey = options.expandKey;
		this.loadMessage = options.loadMessage;
		this.requestRender = options.requestRender;
		this.expanded = options.expanded;
		this.theme = options.theme;
		this.startLoad();
	}

	setExpanded(expanded: boolean): void {
		this.expanded = expanded;
		if (expanded) {
			this.startLoad();
		}
	}

	invalidate(): void {
		return;
	}

	render(width: number): string[] {
		if (!this.expanded && this.loadState.status === "loaded") {
			return skillrefsRefInjection.renderer
				.renderComponent(this.loadState.message, false, this.theme)
				.render(width);
		}

		if (!this.expanded) {
			return renderBox([
				this.theme.fg("customMessageLabel", `Skillrefs: ${this.refs.join(", ")}`),
				this.theme.fg("dim", TEMPLATE.expandHint(this.expandKey)),
			].join("\n"), this.theme).render(width);
		}

		if (this.loadState.status === "loaded") {
			return skillrefsRefInjection.renderer
				.renderComponent(this.loadState.message, true, this.theme)
				.render(width);
		}

		if (this.loadState.status === "error") {
			return renderBox(statusText(this.refs, this.loadState.message, this.theme), this.theme)
				.render(width);
		}

		if (this.loadState.status === "empty") {
			return renderBox(
				statusText(this.refs, "No loaded skills matched these refs.", this.theme),
				this.theme,
			).render(width);
		}

		return renderBox(statusText(this.refs, "Loading skills...", this.theme), this.theme)
			.render(width);
	}

	private startLoad(): void {
		if (this.loadState.status !== "idle") {
			return;
		}

		this.loadState = { status: "loading" };
		void this.loadMessage()
			.then((message) => {
				this.loadState = message ? { status: "loaded", message } : { status: "empty" };
			})
			.catch((error: unknown) => {
				this.loadState = {
					status: "error",
					message: error instanceof Error ? error.message : String(error),
				};
			})
			.finally(this.requestRender);
	}
}

function addSkillrefsAugmentation(
	host: InteractiveModeInstance,
	args: unknown[],
	options: SkillrefsUserMessageAugmentationOptions,
): void {
	const [message, renderOptions] = args;
	if (!isRecord(message) || message.role !== "user") {
		return;
	}

	const text = getUserMessageText(host, message);
	const refs = text ? options.refsForText(text) : [];
	const chatContainer: unknown = Reflect.get(host, "chatContainer");
	if (!text || refs.length === 0 || !hasAddChild(chatContainer)) {
		return;
	}

	chatContainer.addChild(
		new SkillrefsUserMessageComponent({
			refs,
			expandKey: getKeyText(host, "app.tools.expand") ?? SKILLREFS_EXPAND_FALLBACK,
			loadMessage: options.prepareMessage(text, {
				source: isRecord(renderOptions) && renderOptions.populateHistory === true
					? "history"
					: "live",
			}),
			requestRender: () => {
				const ui: unknown = Reflect.get(host, "ui");
				if (!isRecord(ui)) {
					return;
				}
				const requestRender = Reflect.get(ui, "requestRender");
				if (typeof requestRender === "function") {
					requestRender.call(ui);
				}
			},
			expanded: Reflect.get(host, "toolOutputExpanded") === true,
			theme: options.theme,
		}),
	);
}

export function installSkillrefsUserMessageAugmentation(
	options: SkillrefsUserMessageAugmentationOptions,
): () => void {
	const previousAddMessageToChat = Reflect.get(InteractiveMode.prototype, "addMessageToChat");
	if (typeof previousAddMessageToChat !== "function") {
		return () => undefined;
	}

	let active = true;
	function addMessageToChatWithSkillrefs(
		this: InteractiveModeInstance,
		...args: unknown[]
	): unknown {
		const result: unknown = previousAddMessageToChat.apply(this, args);
		if (!active) {
			return result;
		}

		try {
			addSkillrefsAugmentation(this, args, options);
		} catch (error) {
			console.warn("pi-skillrefs: failed to render user-message augmentation", error);
		}

		return result;
	}

	Reflect.set(InteractiveMode.prototype, "addMessageToChat", addMessageToChatWithSkillrefs);
	return () => {
		active = false;
	};
}
