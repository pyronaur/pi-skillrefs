import {
	CustomEditor,
	type ExtensionAPI,
	type KeybindingsManager,
} from "@mariozechner/pi-coding-agent";
import type {
	AutocompleteItem,
	AutocompleteProvider,
	EditorTheme,
	TUI,
} from "@mariozechner/pi-tui";
import {
	composeRememberedSessionEditorComponent,
	type SessionEditorComponentFactory,
} from "@siddr/pi-shared-qna/session-editor-component";
import { buildInjectedSkillMessage } from "./injected-skill-message.js";
import {
	buildSkillAutocompleteItems,
	collectDiscoveredSkills,
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
	cwd?: string;
	sessionManager?: {
		getSessionFile?: () => string | undefined;
		getSessionId?: () => string | undefined;
	};
	ui: {
		setEditorComponent(factory: SessionEditorComponentFactory): void;
	};
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

	constructor(
		tui: TUI,
		theme: EditorTheme,
		options: {
			keybindings: KeybindingsManager;
			getSkillItems: () => AutocompleteItem[];
		},
	) {
		super(tui, theme, options.keybindings);
		this.getSkillItems = options.getSkillItems;
	}

	override setAutocompleteProvider(provider: AutocompleteProvider): void {
		super.setAutocompleteProvider(createMentionAutocompleteProvider(provider, this.getSkillItems));
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
): TEditor {
	if (isEnhanced(editor)) {
		return editor;
	}
	markEnhanced(editor);

	const baseSetAutocompleteProvider = editor.setAutocompleteProvider.bind(editor);
	editor.setAutocompleteProvider = (provider: AutocompleteProvider) => {
		baseSetAutocompleteProvider(createMentionAutocompleteProvider(provider, getSkillItems));
	};

	const baseHandleInput = editor.handleInput.bind(editor);
	editor.handleInput = (data: string) => {
		baseHandleInput(data);
		updateAutocomplete(editor, data);
	};

	return editor;
}

function createEditorFactory(
	previousFactory: SessionEditorComponentFactory | undefined,
	getSkillItems: () => AutocompleteItem[],
): SessionEditorComponentFactory {
	return (tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) => {
		const previousEditor = previousFactory?.(tui, theme, keybindings);
		if (isSkillRefsEditorTarget(previousEditor)) {
			return enhanceEditorWithSkillRefs(previousEditor, getSkillItems);
		}

		return new SkillRefsEditor(tui, theme, { keybindings, getSkillItems });
	};
}

function installEditor(
	ctx: SkillRefsSessionContext,
	getSkillItems: () => AutocompleteItem[],
): void {
	const componentContext = {
		...(ctx.cwd === undefined ? {} : { cwd: ctx.cwd }),
		...(ctx.sessionManager === undefined ? {} : { sessionManager: ctx.sessionManager }),
		ui: {
			setEditorComponent: (factory: SessionEditorComponentFactory | undefined) =>
				ctx.ui.setEditorComponent(factory),
		},
	};

	composeRememberedSessionEditorComponent(
		componentContext,
		(previousFactory) => createEditorFactory(previousFactory, getSkillItems),
	);
}

export default function piSkillrefs(pi: ExtensionAPI): void {
	let skillMap = new Map<string, string>();
	let skillItems: AutocompleteItem[] = [];

	function refreshSkillMap(): void {
		skillMap = collectDiscoveredSkills(pi.getCommands());
		skillItems = buildSkillAutocompleteItems(skillMap);
	}

	pi.on("session_start", (_event, ctx) => {
		refreshSkillMap();
		if (!ctx.hasUI) {
			return;
		}

		installEditor(ctx, () => skillItems);
	});

	pi.on("resources_discover", () => {
		refreshSkillMap();
	});

	pi.on("input", () => {
		return { action: "continue" };
	});

	pi.on("before_agent_start", async (event) => {
		const message = await buildInjectedSkillMessage(event.prompt, skillMap);
		if (!message) {
			return undefined;
		}

		return {
			message: {
				customType: "skillrefs",
				content: message,
				display: false,
			},
		};
	});
}
