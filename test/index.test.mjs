import { estimateTokens } from "@mariozechner/pi-coding-agent";
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
import {
	createCompactionEntry,
	createCustomSkillEntry,
	createSessionManager,
	createUserEntry,
} from "./session-fixtures.mjs";

function createEventBus() {
	const handlers = new Map();

	return {
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
			return () => {
				const current = handlers.get(name) ?? [];
				handlers.set(name, current.filter((item) => item !== handler));
			};
		},
		emit(name, payload) {
			for (const handler of handlers.get(name) ?? []) {
				handler(payload);
			}
		},
	};
}

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
	const messageRenderers = new Map();
	const sentMessages = [];
	const pi = {
		events: createEventBus(),
		on(name, handler) {
			const list = handlers.get(name) ?? [];
			list.push(handler);
			handlers.set(name, list);
		},
		registerMessageRenderer(customType, renderer) {
			messageRenderers.set(customType, renderer);
		},
		sendMessage(message) {
			sentMessages.push(message);
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
		pi,
		getMessageRenderer(customType) {
			return messageRenderers.get(customType);
		},
		getSentMessages() {
			return sentMessages;
		},
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
	const dayPath = join(skillRoot, "day.md");
	const nightPath = join(skillRoot, "night.md");
	await writeFile(dayPath, "You should tell the user that it's daytime.\n", "utf8");
	await writeFile(nightPath, "You should tell the user that it's bedtime.\n", "utf8");

	const harness = createHarness([
		createCommand("skill:day", "skill", dayPath),
		createCommand("skill:night", "skill", nightPath),
	]);
	assert.equal(typeof harness.getMessageRenderer("skillrefs"), "function");
	await harness.emit("resources_discover");

	const inputResult = await harness.emit(
		"input",
		{ text: "Hey nice $day isn't it", images: [], source: "interactive" },
		{},
	);
	assert.deepEqual(inputResult, { action: "continue" });

	const agentStartResult = await harness.emit(
		"before_agent_start",
		{ prompt: "Hey nice $day and $night", images: [], systemPrompt: "base" },
		{},
	);
	assert.equal(agentStartResult, undefined);

	const dayContent =
		`<injected_skill ref="$day">\nYou should tell the user that it's daytime.\n</injected_skill>`;
	const nightContent =
		`<injected_skill ref="$night">\nYou should tell the user that it's bedtime.\n</injected_skill>`;
	assert.deepEqual(harness.getSentMessages(), [
		{
			customType: "skillrefs",
			content: dayContent,
			display: true,
			details: {
				skill: {
					ref: "$day",
					label: "$day",
					path: dayPath,
					mode: "full",
					tokenCount: estimateTokens({
						role: "custom",
						customType: "skillrefs",
						content: dayContent,
						display: true,
						timestamp: 0,
					}),
				},
			},
		},
		{
			customType: "skillrefs",
			content: nightContent,
			display: true,
			details: {
				skill: {
					ref: "$night",
					label: "$night",
					path: nightPath,
					mode: "full",
					tokenCount: estimateTokens({
						role: "custom",
						customType: "skillrefs",
						content: nightContent,
						display: true,
						timestamp: 0,
					}),
				},
			},
		},
	]);
}

async function runResolvedSkillNameTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const skillPath = join(skillRoot, "SKILL.md");
	await writeFile(
		skillPath,
		"---\nname: day\ndescription: Day skill\n---\n\n# Day Skill\n\nRest.\n",
		"utf8",
	);

	const harness = createHarness([createCommand("skill:day", "skill", skillPath)]);
	await harness.emit("resources_discover");

	const agentStartResult = await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day", images: [], systemPrompt: "base" },
		{},
	);

	assert.equal(agentStartResult, undefined);
	assert.equal(harness.getSentMessages()[0].details.skill.label, "Day Skill");
}

async function runReminderInjectionWhenSkillStillInContextTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const dayPath = join(skillRoot, "day.md");
	await writeFile(dayPath, "# Day Skill\n\nRest.\n", "utf8");

	const harness = createHarness([createCommand("skill:day", "skill", dayPath)]);
	await harness.emit("resources_discover");

	const fullContent = `<injected_skill ref="$day">\n# Day Skill\n\nRest.\n</injected_skill>`;
	const ctx = {
		sessionManager: createSessionManager([
			createUserEntry("u1", null, "Use $day"),
			createCustomSkillEntry({ id: "s1", parentId: "u1", content: fullContent }),
			createCompactionEntry("c1", "s1", "s1"),
			createUserEntry("u2", "c1", "Use $day again"),
		], "u2"),
	};

	await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day again", images: [], systemPrompt: "base" },
		ctx,
	);

	assert.equal(harness.getSentMessages()[0].content,
		`<injected_skill ref="$day" path="${dayPath}">Reminder to use $day</injected_skill>`);
	assert.equal(harness.getSentMessages()[0].details.skill.label, "Day Skill");
	assert.equal(harness.getSentMessages()[0].details.skill.path, dayPath);
	assert.equal(harness.getSentMessages()[0].details.skill.mode, "reminder");
}

async function runFullInjectionWhenSkillExistsOnlyOnInactiveBranchTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const dayPath = join(skillRoot, "day.md");
	await writeFile(dayPath, "# Day Skill\n\nRest.\n", "utf8");

	const harness = createHarness([createCommand("skill:day", "skill", dayPath)]);
	await harness.emit("resources_discover");

	const fullContent = `<injected_skill ref="$day">\n# Day Skill\n\nRest.\n</injected_skill>`;
	const ctx = {
		sessionManager: createSessionManager([
			createUserEntry("u1", null, "Root"),
			createCustomSkillEntry({ id: "s1", parentId: "u1", content: fullContent }),
			createUserEntry("u2", "u1", "Other branch"),
		], "u2"),
	};

	await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day", images: [], systemPrompt: "base" },
		ctx,
	);

	assert.equal(harness.getSentMessages()[0].content, fullContent);
	assert.equal(harness.getSentMessages()[0].details.skill.mode, "full");
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

async function runPiFzfpCompatibilityTest() {
	const harness = createHarness([
		createCommand("skill:commit", "skill", "/skills/commit/SKILL.md"),
	]);
	let acked = false;
	harness.pi.events.emit("pi-fzfp:check-editor", () => {
		acked = true;
	});

	const wrapAutocomplete = (provider) => ({ wrappedFrom: provider });
	harness.pi.events.emit("pi-fzfp:provider", wrapAutocomplete);

	const session = createUiSessionContext();

	try {
		await harness.emit("session_start", {}, session.ctx);
		const installedFactory = session.getInstalledFactory();
		assert.equal(acked, true);
		assert.equal(typeof installedFactory, "function");

		const editor = installedFactory(
			{ requestRender() {} },
			{ borderColor: (text) => text, selectList: {} },
			{ matches: () => false },
		);
		const provider = createNullAutocompleteProvider();
		editor.setAutocompleteProvider(provider);

		assert.equal("wrappedFrom" in editor.autocompleteProvider, true);
		assert.notEqual(editor.autocompleteProvider.wrappedFrom, provider);
		assert.equal(
			typeof editor.autocompleteProvider.wrappedFrom.getSuggestions,
			"function",
		);
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
	void test("keeps user text unchanged and injects visible skill context", runInjectionTest);
	void test("resolves skill summary names from skill headings", runResolvedSkillNameTest);
	void test("injects only a reminder when the full skill text is still on the active path",
		runReminderInjectionWhenSkillStillInContextTest);
	void test("reinjects the full skill text when it exists only on an inactive branch",
		runFullInjectionWhenSkillExistsOnlyOnInactiveBranchTest);
	void test("keeps $ autocomplete when another editor extension installs first",
		runCompositionTest);
	void test("cooperates with pi-fzfp editor handshake", runPiFzfpCompatibilityTest);
});
