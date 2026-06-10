import { CustomEditor, type ExtensionUIContext } from "@earendil-works/pi-coding-agent";

const ANSI_PATTERN = new RegExp(`${String.fromCharCode(27)}(?:[@-Z\\\\-_]|\\[[0-?]*[ -/]*[@-~])`,
	"gu");
const EDITOR_BORDER_PATTERN = /^[─━]+(?: [↑↓] \d+ more [─━]*)?$/u;
const SKILLREF_TOKEN_PATTERN = /(?:^|(?<=\s))\$([a-zA-Z][a-zA-Z0-9\-_]*)/g;
const patchedEditors = new WeakSet<EditorComponent>();
const patchedFactories = new WeakSet<EditorFactory>();
const patchedUis = new WeakSet<SkillrefEditorUI>();

type EditorFactory = NonNullable<ReturnType<ExtensionUIContext["getEditorComponent"]>>;
type EditorComponent = ReturnType<EditorFactory>;
type SkillMapLookup = Pick<Map<string, string>, "has">;
type SkillrefEditorUI = Pick<
	ExtensionUIContext,
	"getEditorComponent" | "setEditorComponent" | "theme"
>;
type StyleSkillref = (ref: string) => string;

function isDefaultEditorBoundary(line: string): boolean {
	return EDITOR_BORDER_PATTERN.test(line.replace(ANSI_PATTERN, "").trim());
}

function findDefaultEditorBoundaries(
	lines: readonly string[],
): { top: number; bottom: number } | null {
	const top = lines.findIndex((line) => isDefaultEditorBoundary(line));
	if (top === -1) {
		return null;
	}

	for (let index = top + 1; index < lines.length; index += 1) {
		if (isDefaultEditorBoundary(lines[index] ?? "")) {
			return { top, bottom: index };
		}
	}
	return null;
}

function uniqueKnownRefs(line: string, skills: SkillMapLookup): string[] {
	const refs = [];
	for (const match of line.matchAll(SKILLREF_TOKEN_PATTERN)) {
		const name = match[1];
		if (name && skills.has(name)) {
			refs.push(`$${name}`);
		}
	}

	return [...new Set(refs)].sort((left, right) => right.length - left.length);
}

function defaultEditorFactory(): EditorFactory {
	return (tui, theme, keybindings) => new CustomEditor(tui, theme, keybindings);
}

function patchEditorRender<T extends EditorComponent>(
	editor: T,
	getSkills: () => SkillMapLookup,
	styleSkillref: StyleSkillref,
): T {
	if (patchedEditors.has(editor)) {
		return editor;
	}
	if (typeof editor.render !== "function") {
		return editor;
	}

	const originalRender = editor.render.bind(editor);
	const render: EditorComponent["render"] = (width) =>
		styleRenderedEditorLines(originalRender(width), getSkills(), styleSkillref);
	editor.render = render;
	patchedEditors.add(editor);
	return editor;
}

function wrapEditorFactory(
	factory: EditorFactory,
	getSkills: () => SkillMapLookup,
	styleSkillref: StyleSkillref,
): EditorFactory {
	if (patchedFactories.has(factory)) {
		return factory;
	}

	const wrappedFactory: EditorFactory = (tui, theme, keybindings) =>
		patchEditorRender(factory(tui, theme, keybindings), getSkills, styleSkillref);
	patchedFactories.add(wrappedFactory);
	return wrappedFactory;
}

export function styleKnownSkillrefsInRenderedLine(
	line: string,
	skills: SkillMapLookup,
	styleSkillref: StyleSkillref,
): string {
	let styled = line;
	for (const ref of uniqueKnownRefs(line, skills)) {
		styled = styled.split(ref).join(styleSkillref(ref));
	}
	return styled;
}

export function styleRenderedEditorLines(
	lines: string[],
	skills: SkillMapLookup,
	styleSkillref: StyleSkillref,
): string[] {
	const boundaries = findDefaultEditorBoundaries(lines);
	if (!boundaries) {
		return lines;
	}

	return lines.map((line, lineIndex) =>
		lineIndex > boundaries.top && lineIndex < boundaries.bottom
			? styleKnownSkillrefsInRenderedLine(line, skills, styleSkillref)
			: line
	);
}

export function installSkillrefEditorStyling(
	ui: SkillrefEditorUI,
	getSkills: () => SkillMapLookup,
): void {
	const styleSkillref = (ref: string) => ui.theme.fg("accent", ui.theme.bold(ref));
	if (!patchedUis.has(ui)) {
		const originalSetEditorComponent = ui.setEditorComponent.bind(ui);
		ui.setEditorComponent = (factory) => {
			originalSetEditorComponent(
				factory ? wrapEditorFactory(factory, getSkills, styleSkillref) : undefined,
			);
		};
		patchedUis.add(ui);
	}

	const currentFactory = ui.getEditorComponent();
	ui.setEditorComponent(
		wrapEditorFactory(currentFactory ?? defaultEditorFactory(), getSkills, styleSkillref),
	);
}
