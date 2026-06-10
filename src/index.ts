import {
	type ContextEvent,
	CustomEditor,
	type ExtensionAPI,
	type ExtensionContext,
	type ExtensionUIContext,
	type KeybindingsManager,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	EditorTheme,
	TUI,
} from "@earendil-works/pi-tui";
import { buildInjectedSkillMessage } from "./injected-skill-message.js";
import {
	SkillrefsBranchState,
	type SkillrefsRenderSource,
} from "./models/SkillrefsBranchState.js";
import {
	type SkillrefsCustomMessage,
	SkillrefsCustomMessages,
} from "./models/SkillrefsCustomMessage.js";
import {
	registerPiFzfpCompatibility,
	type WrapAutocomplete,
} from "./pi-fzfp-compat.js";
import { renderSkillrefsMessage } from "./render-skillrefs-message.js";
import { installSkillrefEditorStyling } from "./skillref-editor-styling.js";
import {
	contextMessagesForSkillrefsRender,
	sessionContextMessages,
} from "./skillrefs-render-context.js";
import { installSkillrefsUserMessageAugmentation } from "./skillrefs-user-message-augmentation.js";
import {
	buildSkillAutocompleteItems,
	collectDiscoveredSkills,
	collectMentionedSkills,
	createMentionAutocompleteProvider,
	findMentionTokenAtCursor,
} from "./utils.js";

type Cursor = {
	line: number;
	col: number;
};

type SkillRefsEditorTarget = {
	setAutocompleteProvider(provider: AutocompleteProvider): void;
	handleInput(data: string): void;
	isShowingAutocomplete(): boolean;
	getLines(): string[];
	getCursor(): Cursor;
};

type SkillRefsSessionContext = {
	ui: Pick<ExtensionUIContext, "getEditorComponent" | "setEditorComponent" | "theme">;
};
type ContextMessage = ContextEvent["messages"][number];
type UserContextMessage = ContextMessage & { role: "user" };
type ProviderContextBuild = {
	providerMessages: ContextEvent["messages"];
	providerContext: ReturnType<SkillrefsBranchState["beginProviderContext"]>;
};
type UserMessageRenderContext = {
	source: SkillrefsRenderSource;
};

type SkillRefsRecord = Record<string | symbol, unknown>;

const SKILL_REFS_EDITOR_ENHANCED = Symbol("skillrefs-editor-enhanced");

function isPrintableInput(data: string): boolean {
	return data.length === 1 && data.charCodeAt(0) >= 32;
}

function hasMethod(value: SkillRefsRecord, name: string): boolean {
	return typeof Reflect.get(value, name) === "function";
}

function isObject(value: unknown): value is SkillRefsRecord {
	return typeof value === "object" && value !== null;
}

function isSkillRefsEditorTarget(value: unknown): value is SkillRefsEditorTarget {
	if (!isObject(value)) {
		return false;
	}

	return hasMethod(value, "setAutocompleteProvider")
		&& hasMethod(value, "handleInput")
		&& hasMethod(value, "isShowingAutocomplete")
		&& hasMethod(value, "getLines")
		&& hasMethod(value, "getCursor");
}

function triggerAutocomplete(editor: SkillRefsEditorTarget): void {
	const method = Reflect.get(editor, "tryTriggerAutocomplete");
	if (typeof method !== "function") {
		return;
	}

	Reflect.apply(method, editor, []);
}

function updateAutocomplete(editor: SkillRefsEditorTarget, data: string): void {
	if (editor.isShowingAutocomplete()) {
		return;
	}
	if (!isPrintableInput(data)) {
		return;
	}

	const lines = editor.getLines();
	const cursor = editor.getCursor();
	const line = lines[cursor.line] || "";
	const mention = findMentionTokenAtCursor(line, cursor.col);
	if (!mention) {
		return;
	}

	triggerAutocomplete(editor);
}

class SkillRefsEditor extends CustomEditor {
	private readonly getSkillItems: () => AutocompleteItem[];
	private readonly wrapAutocomplete: WrapAutocomplete | undefined;

	constructor(
		tui: TUI,
		theme: EditorTheme,
		options: {
			keybindings: KeybindingsManager;
			getSkillItems: () => AutocompleteItem[];
			wrapAutocomplete: WrapAutocomplete | undefined;
		},
	) {
		super(tui, theme, options.keybindings);
		this.getSkillItems = options.getSkillItems;
		this.wrapAutocomplete = options.wrapAutocomplete;
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		let nextProvider = createMentionAutocompleteProvider(provider, this.getSkillItems);
		if (this.wrapAutocomplete) {
			nextProvider = this.wrapAutocomplete(nextProvider);
		}

		super.setAutocompleteProvider(nextProvider);
	}

	override handleInput(data: string): void {
		super.handleInput(data);
		updateAutocomplete(this, data);
	}
}

function isEnhanced(editor: SkillRefsRecord): boolean {
	return Reflect.get(editor, SKILL_REFS_EDITOR_ENHANCED) === true;
}

function markEnhanced(editor: SkillRefsRecord): void {
	Reflect.set(editor, SKILL_REFS_EDITOR_ENHANCED, true);
}

function enhanceEditorWithSkillRefs<TEditor extends SkillRefsEditorTarget>(
	editor: TEditor,
	getSkillItems: () => AutocompleteItem[],
	wrapAutocomplete: WrapAutocomplete | undefined,
): TEditor {
	if (isEnhanced(editor)) {
		return editor;
	}
	markEnhanced(editor);

	const baseSetAutocompleteProvider = editor.setAutocompleteProvider.bind(editor);
	editor.setAutocompleteProvider = (provider: AutocompleteProvider) => {
		let nextProvider = createMentionAutocompleteProvider(provider, getSkillItems);
		if (wrapAutocomplete) {
			nextProvider = wrapAutocomplete(nextProvider);
		}

		baseSetAutocompleteProvider(nextProvider);
	};

	const baseHandleInput = editor.handleInput.bind(editor);
	editor.handleInput = (data: string) => {
		baseHandleInput(data);
		updateAutocomplete(editor, data);
	};

	return editor;
}

function installEditor(
	ctx: SkillRefsSessionContext,
	getSkillItems: () => AutocompleteItem[],
	wrapAutocomplete: WrapAutocomplete | undefined,
): void {
	const previousFactory = ctx.ui.getEditorComponent();
	ctx.ui.setEditorComponent((tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
		const previousEditor = previousFactory?.(tui, theme, keybindings);
		if (isSkillRefsEditorTarget(previousEditor)) {
			return enhanceEditorWithSkillRefs(previousEditor, getSkillItems, wrapAutocomplete);
		}

		return new SkillRefsEditor(tui, theme, { keybindings, getSkillItems, wrapAutocomplete });
	});
}

function hasRef(prompt: string, skillMap: Map<string, string>): boolean {
	return collectMentionedSkills(prompt, skillMap).length > 0;
}

function sessionBranch(ctx: ExtensionContext): readonly SessionEntry[] {
	const sessionManager = ctx.sessionManager;
	if (
		!sessionManager
		|| typeof sessionManager.getBranch !== "function"
	) {
		return [];
	}

	return sessionManager.getBranch();
}

type SkillrefsRuntimeState = {
	skillMap: Map<string, string>;
	skillItems: AutocompleteItem[];
	skillrefsState: SkillrefsBranchState;
	wrapAutocomplete: WrapAutocomplete | undefined;
	renderOccurrenceIndex: number;
	disableSkillrefsUserMessageAugmentation: (() => void) | undefined;
};
type RecordUserProviderMessageInput = {
	state: SkillrefsRuntimeState;
	build: ProviderContextBuild;
	message: UserContextMessage;
	index: number;
};
type PrepareSkillrefsUserMessageLoaderInput = {
	state: SkillrefsRuntimeState;
	text: string;
	ctx: ExtensionContext;
	renderContext: UserMessageRenderContext;
};

function createRuntimeState(): SkillrefsRuntimeState {
	return {
		skillMap: new Map(),
		skillItems: [],
		skillrefsState: SkillrefsBranchState.empty(),
		wrapAutocomplete: undefined,
		renderOccurrenceIndex: 0,
		disableSkillrefsUserMessageAugmentation: undefined,
	};
}

function refreshSkillMap(pi: ExtensionAPI, state: SkillrefsRuntimeState): void {
	state.skillMap = collectDiscoveredSkills(pi.getCommands());
	state.skillItems = buildSkillAutocompleteItems(state.skillMap);
}

function rebuildSkillrefsBranchState(
	state: SkillrefsRuntimeState,
	ctx: ExtensionContext,
	knownFullRefs: Iterable<string> = [],
): void {
	const messages = sessionContextMessages(ctx);
	if (!messages) {
		state.skillrefsState = SkillrefsBranchState.empty();
		state.renderOccurrenceIndex = 0;
		return;
	}

	state.skillrefsState = SkillrefsBranchState.fromMessages(
		messages,
		knownFullRefs,
		sessionBranch(ctx),
	);
	state.renderOccurrenceIndex = 0;
}

function stopSession(state: SkillrefsRuntimeState): void {
	state.disableSkillrefsUserMessageAugmentation?.();
	state.disableSkillrefsUserMessageAugmentation = undefined;
	state.skillrefsState = SkillrefsBranchState.empty();
	state.renderOccurrenceIndex = 0;
}

async function buildSkillrefsCustomMessage(
	state: SkillrefsRuntimeState,
	prompt: string,
	fullSkillRefs: Set<string>,
): Promise<SkillrefsCustomMessage | undefined> {
	if (!hasRef(prompt, state.skillMap)) {
		return undefined;
	}

	const message = await buildInjectedSkillMessage(prompt, state.skillMap, { fullSkillRefs });
	return message ? SkillrefsCustomMessages.create(message.content, message.skills) : undefined;
}

function prepareSkillrefsUserMessageLoader(
	input: PrepareSkillrefsUserMessageLoaderInput,
): () => Promise<SkillrefsCustomMessage | undefined> {
	const renderFullRefs = input.state.skillrefsState.prepareRenderFullRefs({
		index: input.state.renderOccurrenceIndex,
		text: input.text,
		source: input.renderContext.source,
	});
	input.state.renderOccurrenceIndex += 1;
	return async () =>
		buildSkillrefsCustomMessage(
			input.state,
			input.text,
			await renderFullRefs.fullRefsFor({
				messages: contextMessagesForSkillrefsRender(input.ctx, {
					text: input.text,
					source: input.renderContext.source,
				}),
				buildContext: {
					buildSkillrefsCustomMessage: (messageText, fullRefs) =>
						buildSkillrefsCustomMessage(input.state, messageText, fullRefs),
				},
			}),
		);
}

async function recordUserProviderMessage(
	input: RecordUserProviderMessageInput,
): Promise<void> {
	const plan = input.build.providerContext.planUserMessage(input.message, input.index);
	if (plan.action !== "inject") {
		return;
	}

	const skillrefsMessage = await buildSkillrefsCustomMessage(
		input.state,
		plan.text,
		new Set(plan.fullRefsBefore),
	);
	input.build.providerContext.recordInjection(plan, skillrefsMessage);
	const injectedContent = skillrefsMessage?.details.injectedContent;
	if (!injectedContent) {
		return;
	}

	input.build.providerMessages.push({
		role: "user",
		content: injectedContent,
		timestamp: input.message.timestamp,
	});
}

async function buildProviderContextMessages(
	state: SkillrefsRuntimeState,
	messages: ContextEvent["messages"],
	ctx: ExtensionContext,
): Promise<ContextEvent["messages"]> {
	const providerContext = state.skillrefsState.beginProviderContext(messages, sessionBranch(ctx));
	const build: ProviderContextBuild = {
		providerMessages: [],
		providerContext,
	};

	for (const [index, message] of messages.entries()) {
		const restoredMessage = SkillrefsCustomMessages.restoreContent(message);
		build.providerMessages.push(restoredMessage);

		if (message.role === "user") {
			await recordUserProviderMessage({ state, build, message, index });
			continue;
		}

		build.providerContext.recordContextMessage(message);
	}

	state.skillrefsState = SkillrefsBranchState.fromRefInjectionState(providerContext.finish());
	return build.providerMessages;
}

function installSessionUi(ctx: SkillRefsSessionContext, state: SkillrefsRuntimeState): void {
	installEditor(ctx, () => state.skillItems, state.wrapAutocomplete);
	installSkillrefEditorStyling(ctx.ui, () => state.skillMap);
}

function installUserMessageAugmentation(
	pi: ExtensionAPI,
	state: SkillrefsRuntimeState,
	ctx: ExtensionContext,
): void {
	state.disableSkillrefsUserMessageAugmentation = installSkillrefsUserMessageAugmentation({
		theme: ctx.ui.theme,
		refsForText(text) {
			refreshSkillMap(pi, state);
			return collectMentionedSkills(text, state.skillMap).map((skill) => `$${skill.name}`);
		},
		prepareMessage(text, renderContext) {
			refreshSkillMap(pi, state);
			return prepareSkillrefsUserMessageLoader({ state, text, ctx, renderContext });
		},
	});
}

function replayTreeState(state: SkillrefsRuntimeState, ctx: ExtensionContext): void {
	const messages = sessionContextMessages(ctx);
	state.skillrefsState = messages
		? state.skillrefsState.replayForMessages(messages)
		: SkillrefsBranchState.empty();
	state.renderOccurrenceIndex = 0;
}

export default function piSkillrefs(pi: ExtensionAPI): void {
	const state = createRuntimeState();
	pi.registerMessageRenderer(SkillrefsCustomMessages.type, renderSkillrefsMessage);

	registerPiFzfpCompatibility(pi, (nextWrapAutocomplete) => {
		state.wrapAutocomplete = nextWrapAutocomplete;
	});

	pi.on("session_start", (_event, ctx) => {
		stopSession(state);
		refreshSkillMap(pi, state);
		rebuildSkillrefsBranchState(state, ctx);
		if (!ctx.hasUI) {
			return;
		}

		installSessionUi(ctx, state);
		installUserMessageAugmentation(pi, state, ctx);
	});

	pi.on("resources_discover", () => {
		refreshSkillMap(pi, state);
	});

	pi.on("session_compact", (_event, ctx) => {
		rebuildSkillrefsBranchState(state, ctx);
		return undefined;
	});

	pi.on("session_tree", (_event, ctx) => {
		replayTreeState(state, ctx);
		return undefined;
	});

	pi.on("session_shutdown", () => {
		stopSession(state);
	});

	pi.on("input", () => {
		return { action: "continue" };
	});

	pi.on("context", async (event, ctx) => {
		refreshSkillMap(pi, state);
		return {
			messages: await buildProviderContextMessages(state, event.messages, ctx),
		};
	});
}
