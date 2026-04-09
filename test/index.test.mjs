import {
	clearRememberedSessionEditorComponentFactory,
	composeRememberedSessionEditorComponent,
} from "@siddr/pi-shared-qna/session-editor-component";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import piSkillrefs from "../src/index.ts";

function createCommand(name, source, path) {
	return {
		name,
		source,
		sourceInfo: {
			path: path ?? `<${source}:${name}>`,
			source,
			scope: "temporary",
			origin: "top-level",
		},
	};
}

function createThinkingEditor() {
	return {
		lines: [""],
		cursor: { line: 0, col: 0 },
		autocompleteProvider: undefined,
		autocompleteVisible: false,
		autocompleteItems: [],
		setAutocompleteProvider(provider) {
			this.autocompleteProvider = provider;
		},
		handleInput(data) {
			if (data === "^") {
				this.autocompleteVisible = true;
				this.autocompleteItems = [{ value: "low", label: "low" }];
				return;
			}
			if (data.length === 1) {
				this.lines[0] += data;
				this.cursor.col += 1;
			}
			if (!this.autocompleteProvider) {
				return;
			}
			void updateAutocomplete(this);
		},
		isShowingAutocomplete() {
			return this.autocompleteVisible;
		},
		getLines() {
			return this.lines;
		},
		getCursor() {
			return this.cursor;
		},
		async tryTriggerAutocomplete() {
			await updateAutocomplete(this);
		},
	};
}

async function updateAutocomplete(editor) {
	const result = await editor.autocompleteProvider?.getSuggestions(
		editor.lines,
		editor.cursor.line,
		editor.cursor.col,
		{ signal: AbortSignal.abort() },
	);
	if (!result) {
		return;
	}
	editor.autocompleteVisible = true;
	editor.autocompleteItems = result.items;
}

function fakeThinkingExtension(pi) {
	pi.on("session_start", (_event, ctx) => {
		composeRememberedSessionEditorComponent(ctx, () => {
			return () => createThinkingEditor();
		});
	});
}

function createHarness(commands, extensionOrder = ["skillrefs"]) {
	const handlers = new Map();
	const pi = {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		getCommands() {
			return commands;
		},
	};

	for (const extensionName of extensionOrder) {
		if (extensionName === "skillrefs") {
			piSkillrefs(pi);
			continue;
		}
		fakeThinkingExtension(pi);
	}

	return {
		async emit(name, event = {}, ctx = {}) {
			const list = handlers.get(name) ?? [];
			let result;
			for (const handler of list) {
				result = await handler(event, ctx);
			}
			return result;
		},
	};
}

function createUiSessionContext() {
	const sessionFile = join(tmpdir(), `pi-skillrefs-${Date.now()}-${Math.random()}.json`);
	let installedFactory;
	return {
		sessionFile,
		getInstalledFactory: () => installedFactory,
		ctx: {
			hasUI: true,
			cwd: tmpdir(),
			sessionManager: {
				getSessionFile() {
					return sessionFile;
				},
			},
			ui: {
				setEditorComponent(factory) {
					installedFactory = factory;
				},
			},
		},
	};
}

function cleanupSession(sessionFile) {
	clearRememberedSessionEditorComponentFactory({
		sessionManager: {
			getSessionFile() {
				return sessionFile;
			},
		},
	});
}

function createNullAutocompleteProvider() {
	return {
		async getSuggestions() {
			return null;
		},
		applyCompletion(...args) {
			const [lines, cursorLine, cursorCol, item, prefix] = args;
			const line = lines[cursorLine] || "";
			const startCol = cursorCol - prefix.length;
			const newLine = line.slice(0, startCol) + item.value + line.slice(cursorCol);
			const newLines = [...lines];
			newLines[cursorLine] = newLine;
			return { lines: newLines, cursorLine, cursorCol: startCol + item.value.length };
		},
	};
}

async function runInstallEditorTest() {
	const harness = createHarness([
		createCommand("skill:commit", "skill", "/skills/commit/SKILL.md"),
	]);
	const session = createUiSessionContext();

	try {
		await harness.emit("session_start", {}, session.ctx);
		assert.equal(typeof session.getInstalledFactory(), "function");
	} finally {
		cleanupSession(session.sessionFile);
	}
}

async function runInjectionTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const skillPath = join(skillRoot, "SKILL.md");
	await writeFile(skillPath, "You should tell the user that it's bedtime.\n", "utf8");

	const harness = createHarness([createCommand("skill:day", "skill", skillPath)]);
	await harness.emit("resources_discover");

	const inputResult = await harness.emit(
		"input",
		{ text: "Hey nice $day isn't it", images: [], source: "interactive" },
		{},
	);
	assert.deepEqual(inputResult, { action: "continue" });

	const agentStartResult = await harness.emit(
		"before_agent_start",
		{ prompt: "Hey nice $day isn't it", images: [], systemPrompt: "base" },
		{},
	);

	assert.deepEqual(agentStartResult, {
		message: {
			customType: "skillrefs",
			content:
				`<injected_skill ref="$day">\nYou should tell the user that it's bedtime.\n</injected_skill>`,
			display: false,
		},
	});
}

async function runCompositionTest() {
	const harness = createHarness(
		[createCommand("skill:commit", "skill", "/skills/commit/SKILL.md")],
		["thinking", "skillrefs"],
	);
	const session = createUiSessionContext();

	try {
		await harness.emit("session_start", {}, session.ctx);
		const installedFactory = session.getInstalledFactory();
		assert.equal(typeof installedFactory, "function");

		const editor = installedFactory();
		editor.setAutocompleteProvider(createNullAutocompleteProvider());
		editor.handleInput("$");
		await editor.tryTriggerAutocomplete();

		assert.equal(editor.isShowingAutocomplete(), true);
		assert.equal(editor.autocompleteItems[0]?.value, "$commit");
	} finally {
		cleanupSession(session.sessionFile);
	}
}

const dirsToRemove = [];

afterEach(async () => {
	await Promise.all(dirsToRemove.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

void describe("pi-skillrefs", () => {
	void test("installs a custom editor on session start", runInstallEditorTest);
	void test(
		"keeps user text unchanged and injects hidden skill context before the agent starts",
		runInjectionTest,
	);
	void test("keeps $ autocomplete when another editor extension installs first",
		runCompositionTest);
});
