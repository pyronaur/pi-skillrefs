import {
	AuthStorage,
	createEventBus as createPiEventBus,
	createExtensionRuntime,
	createSyntheticSourceInfo,
	estimateTokens,
	ExtensionRunner,
	ModelRegistry,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, test } from "node:test";
import piSkillrefs from "../src/index.ts";
import {
	styleKnownSkillrefsInRenderedLine,
	styleRenderedEditorLines,
} from "../src/skillref-editor-styling.ts";
import {
	buildSkillAutocompleteItems,
	createMentionAutocompleteProvider,
} from "../src/utils.ts";
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

function noop() {}

function getUndefined() {
	return undefined;
}

function getEmptyArray() {
	return [];
}

function getFalse() {
	return false;
}

function getTrue() {
	return true;
}

function getThinkingOff() {
	return "off";
}

function getEmptyString() {
	return "";
}

function commandGetter(commands) {
	return () => commands;
}

function addHandler(handlers, name, handler) {
	const list = handlers.get(name) ?? [];
	list.push(handler);
	handlers.set(name, list);
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
		ctx.ui.setEditorComponent(() => createThinkingEditor());
	});
}

function createHarness(commands, extensionOrder = ["skillrefs"]) {
	const handlers = new Map();
	const messageRenderers = new Map();
	const pi = {
		events: createEventBus(),
		on(name, handler) {
			addHandler(handlers, name, handler);
		},
		registerMessageRenderer: messageRenderers.set.bind(messageRenderers),
		getCommands: commandGetter(commands),
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
		getMessageRenderer: messageRenderers.get.bind(messageRenderers),
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

function createRunnerHarness(commands) {
	const extensionPath = "/tmp/pi-skillrefs.ts";
	const runtime = createExtensionRuntime();
	const handlers = new Map();
	const messageRenderers = new Map();
	const extension = {
		path: extensionPath,
		resolvedPath: extensionPath,
		sourceInfo: createSyntheticSourceInfo("extension", extensionPath),
		handlers,
		tools: new Map(),
		messageRenderers,
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
	};
	piSkillrefs({
		events: createPiEventBus(),
		on(name, handler) {
			addHandler(handlers, name, handler);
		},
		registerMessageRenderer: messageRenderers.set.bind(messageRenderers),
		getCommands: () => runtime.getCommands(),
	});
	const runner = new ExtensionRunner(
		[extension],
		runtime,
		process.cwd(),
		SessionManager.inMemory(),
		ModelRegistry.inMemory(AuthStorage.inMemory()),
	);
	runner.bindCore({
		sendMessage: noop,
		sendUserMessage: noop,
		appendEntry: noop,
		setSessionName: noop,
		getSessionName: getUndefined,
		setLabel: noop,
		getActiveTools: getEmptyArray,
		getAllTools: getEmptyArray,
		setActiveTools: noop,
		refreshTools: noop,
		getCommands: commandGetter(commands),
		setModel: getFalse,
		getThinkingLevel: getThinkingOff,
		setThinkingLevel: noop,
	}, {
		getModel: getUndefined,
		isIdle: getTrue,
		getSignal: getUndefined,
		abort: noop,
		hasPendingMessages: getFalse,
		shutdown: noop,
		getContextUsage: getUndefined,
		compact: noop,
		getSystemPrompt: getEmptyString,
	});
	return runner;
}

async function createDaySkillHarness() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const dayPath = join(skillRoot, "day.md");
	await writeFile(dayPath, "# Day Skill\n\nRest.\n", "utf8");
	const dayRealPath = await realpath(dayPath);
	const harness = createHarness([createCommand("skill:day", "skill", dayPath)]);
	await harness.emit("resources_discover");
	const fullContent =
		`<injected_skill ref="$day" path="${dayRealPath}">\n# Day Skill\n\nRest.\n</injected_skill>`;

	return { dayRealPath, fullContent, harness };
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
				theme: {
					bold(text) {
						return `<bold>${text}</bold>`;
					},
					fg(color, text) {
						return `<${color}>${text}</${color}>`;
					},
				},
				getEditorComponent() {
					return installedFactory;
				},
				setEditorComponent(factory) {
					installedFactory = factory;
				},
			},
		},
	};
}

function getInjectedMessage(result) {
	assert.ok(result?.message);
	return result.message;
}

function applyAutocompleteCompletion(...args) {
	const [lines, cursorLine, cursorCol, item, prefix] = args;
	const line = lines[cursorLine] || "";
	const startCol = cursorCol - prefix.length;
	const newLine = line.slice(0, startCol) + item.value + line.slice(cursorCol);
	const newLines = [...lines];
	newLines[cursorLine] = newLine;
	return { lines: newLines, cursorLine, cursorCol: startCol + item.value.length };
}

function createNullAutocompleteProvider() {
	return {
		async getSuggestions() {
			return null;
		},
		applyCompletion: applyAutocompleteCompletion,
	};
}

function createFileAutocompleteProvider() {
	return {
		async getSuggestions() {
			return { items: [{ value: "src/index.ts", label: "src/index.ts" }], prefix: "" };
		},
		applyCompletion: applyAutocompleteCompletion,
	};
}

async function runAutocompleteCancelAfterSpaceTest() {
	const provider = createMentionAutocompleteProvider(
		createFileAutocompleteProvider(),
		() => buildSkillAutocompleteItems(new Map([["day", "/skills/day/SKILL.md"]])),
	);

	assert.equal(await provider.getSuggestions(["$ "], 0, 2, {
		signal: AbortSignal.abort(),
	}), null);
	assert.equal(await provider.getSuggestions(["Use $day "], 0, 9, {
		signal: AbortSignal.abort(),
	}), null);
}

async function runFuzzyAutocompleteTest() {
	const provider = createMentionAutocompleteProvider(
		createFileAutocompleteProvider(),
		() =>
			buildSkillAutocompleteItems(new Map([
				["code-effect", "/skills/code-effect/SKILL.md"],
				["code-ts", "/skills/code-ts/SKILL.md"],
			])),
	);

	const suggestions = await provider.getSuggestions(["Use $cts"], 0, 8, {
		signal: AbortSignal.abort(),
	});

	assert.equal(suggestions?.prefix, "$cts");
	assert.equal(suggestions?.items[0]?.value, "$code-ts");
}

async function runInstallEditorTest() {
	const harness = createHarness([
		createCommand("skill:commit", "skill", "/skills/commit/SKILL.md"),
	]);
	const session = createUiSessionContext();

	await harness.emit("session_start", {}, session.ctx);
	assert.equal(typeof session.getInstalledFactory(), "function");
}

async function runExtensionRunnerInjectionTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-runner-"));
	dirsToRemove.push(skillRoot);
	const skillPath = join(skillRoot, "SKILL.md");
	await writeFile(
		skillPath,
		"---\ntitle: Code TS\nsummary: TypeScript rules: strict imports\n---\n\n# Code TS\n\nUse strict types.\n",
		"utf8",
	);
	const realSkillPath = await realpath(skillPath);
	const runner = createRunnerHarness([createCommand("skill:code-ts", "skill", skillPath)]);

	await runner.emitResourcesDiscover(process.cwd(), "startup");
	const result = await runner.emitBeforeAgentStart("Use $code-ts", [], "base", {});
	const message = result?.messages?.[0];
	assert.equal(message?.customType, "pi-skillrefs");
	assert.equal(message?.content, "$code-ts");
	assert.match(message?.details.injectedContent ?? "", /Use strict types\./u);
	assert.equal(message?.details.skills[0].path, realSkillPath);

	const restored = await runner.emitContext([{ role: "custom", timestamp: 0, ...message }]);
	assert.equal(restored[0].content, message.details.injectedContent);
}

async function runInjectionTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const dayPath = join(skillRoot, "day.md");
	const nightPath = join(skillRoot, "night.md");
	await writeFile(dayPath, "You should tell the user that it's daytime.\n", "utf8");
	await writeFile(nightPath, "You should tell the user that it's bedtime.\n", "utf8");
	const dayRealPath = await realpath(dayPath);
	const nightRealPath = await realpath(nightPath);
	const harness = createHarness([
		createCommand("skill:day", "skill", dayPath),
		createCommand("skill:night", "skill", nightPath),
	]);
	assert.equal(typeof harness.getMessageRenderer("pi-skillrefs"), "function");
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
	const dayContent =
		`<injected_skill ref="$day" path="${dayRealPath}">\nYou should tell the user that it's daytime.\n</injected_skill>`;
	const nightContent =
		`<injected_skill ref="$night" path="${nightRealPath}">\nYou should tell the user that it's bedtime.\n</injected_skill>`;
	const content = `<environment_context>\n${dayContent}\n\n${nightContent}\n</environment_context>`;
	const message = getInjectedMessage(agentStartResult);
	assert.deepEqual(message, {
		customType: "pi-skillrefs",
		content: "$day, $night",
		display: true,
		details: {
			injectedContent: content,
			skills: [
				{
					ref: "$day",
					label: "$day",
					path: dayRealPath,
					mode: "full",
					tokenCount: estimateTokens({
						role: "custom",
						customType: "pi-skillrefs",
						content: dayContent,
						display: true,
						timestamp: 0,
					}),
				},
				{
					ref: "$night",
					label: "$night",
					path: nightRealPath,
					mode: "full",
					tokenCount: estimateTokens({
						role: "custom",
						customType: "pi-skillrefs",
						content: nightContent,
						display: true,
						timestamp: 0,
					}),
				},
			],
		},
	});

	const contextResult = await harness.emit("context", {
		messages: [{ role: "custom", timestamp: 0, ...message }],
	});
	assert.equal(contextResult.messages[0].content, content);
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
	const realSkillPath = await realpath(skillPath);
	const agentStartResult = await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day", images: [], systemPrompt: "base" },
		{},
	);

	const message = getInjectedMessage(agentStartResult);
	assert.equal(message.details.skills[0].label, "Day Skill");
	assert.equal(message.content, "$day");
	assert.equal(
		message.details.injectedContent,
		`<environment_context>\n<injected_skill ref="$day" path="${realSkillPath}">\n# Day Skill\n\nRest.\n</injected_skill>\n</environment_context>`,
	);
}

async function runReminderInjectionWhenSkillStillInContextTest() {
	const { dayRealPath, fullContent, harness } = await createDaySkillHarness();
	const ctx = {
		sessionManager: createSessionManager([
			createUserEntry("u1", null, "Use $day"),
			createCustomSkillEntry({
				id: "s1",
				parentId: "u1",
				content: `<environment_context>\n${fullContent}\n</environment_context>`,
				details: {
					skills: [{ ref: "$day", mode: "full" }],
				},
			}),
			createCompactionEntry("c1", "s1", "s1"),
			createUserEntry("u2", "c1", "Use $day again"),
		], "u2"),
	};

	const result = await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day again", images: [], systemPrompt: "base" },
		ctx,
	);
	const message = getInjectedMessage(result);

	assert.equal(message.content, "$day");
	assert.equal(
		message.details.injectedContent,
		`<environment_context>\n<injected_skill ref="$day" path="${dayRealPath}">Reminder to use $day</injected_skill>\n</environment_context>`,
	);
	assert.equal(message.details.skills[0].label, "Day Skill");
	assert.equal(message.details.skills[0].path, dayRealPath);
	assert.equal(message.details.skills[0].mode, "reminder");
}

async function runFullInjectionWhenSkillExistsOnlyOnInactiveBranchTest() {
	const { fullContent, harness } = await createDaySkillHarness();
	const ctx = {
		sessionManager: createSessionManager([
			createUserEntry("u1", null, "Root"),
			createCustomSkillEntry({ id: "s1", parentId: "u1", content: fullContent }),
			createUserEntry("u2", "u1", "Other branch"),
		], "u2"),
	};

	const result = await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day", images: [], systemPrompt: "base" },
		ctx,
	);
	const message = getInjectedMessage(result);

	assert.equal(message.content, "$day");
	assert.equal(
		message.details.injectedContent,
		`<environment_context>\n${fullContent}\n</environment_context>`,
	);
	assert.equal(message.details.skills[0].mode, "full");
}

async function runResolvedPathInjectionTest() {
	const skillRoot = await mkdtemp(join(tmpdir(), "pi-skillrefs-skill-"));
	dirsToRemove.push(skillRoot);
	const targetPath = join(skillRoot, "target.md");
	const linkPath = join(skillRoot, "day-link.md");
	await writeFile(targetPath, "# Day Skill\n\nRest.\n", "utf8");
	await symlink(targetPath, linkPath);
	const resolvedPath = await realpath(linkPath);
	const harness = createHarness([createCommand("skill:day", "skill", linkPath)]);
	await harness.emit("resources_discover");
	const result = await harness.emit(
		"before_agent_start",
		{ prompt: "Use $day", images: [], systemPrompt: "base" },
		{},
	);
	const message = getInjectedMessage(result);

	assert.equal(message.content, "$day");
	assert.equal(
		message.details.injectedContent,
		`<environment_context>\n<injected_skill ref="$day" path="${resolvedPath}">\n# Day Skill\n\nRest.\n</injected_skill>\n</environment_context>`,
	);
	assert.equal(message.details.skills[0].path, resolvedPath);
}

async function runCompositionTest() {
	const harness = createHarness(
		[createCommand("skill:commit", "skill", "/skills/commit/SKILL.md")],
		["thinking", "skillrefs"],
	);
	const session = createUiSessionContext();

	await harness.emit("session_start", {}, session.ctx);
	const installedFactory = session.getInstalledFactory();
	assert.equal(typeof installedFactory, "function");

	const editor = installedFactory();
	editor.setAutocompleteProvider(createNullAutocompleteProvider());
	editor.handleInput("$");
	await editor.tryTriggerAutocomplete();

	assert.equal(editor.isShowingAutocomplete(), true);
	assert.equal(editor.autocompleteItems[0]?.value, "$commit");
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
}

function runInlineSkillrefStylingTest() {
	const skills = new Map([["code-ts", "/skills/code-ts/SKILL.md"]]);
	const styled = styleKnownSkillrefsInRenderedLine(
		"Use $code-ts and $missing",
		skills,
		(ref) => `<accent>${ref}</accent>`,
	);

	assert.equal(styled, "Use <accent>$code-ts</accent> and $missing");
}

function runRenderedEditorStylingTest() {
	const skills = new Map([["code-ts", "/skills/code-ts/SKILL.md"]]);
	const lines = [
		"\u001b[38;2;100;200;255m────\u001b[39m",
		"Use $code-ts",
		"\u001b[38;2;100;200;255m────\u001b[39m",
		"→ $code-ts TypeScript Style",
	];
	const styled = styleRenderedEditorLines(lines, skills, (ref) => `<accent>${ref}</accent>`);

	assert.equal(styled[1], "Use <accent>$code-ts</accent>");
	assert.equal(styled[3], lines[3]);
}

const dirsToRemove = [];

afterEach(async () => {
	await Promise.all(dirsToRemove.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

void describe("pi-skillrefs", () => {
	void test("installs a custom editor on session start", runInstallEditorTest);
	void test("fuzzy matches skill names across hyphen boundaries", runFuzzyAutocompleteTest);
	void test("keeps user text unchanged and injects visible skill context", runInjectionTest);
	void test("injects and restores skill context through Pi ExtensionRunner",
		runExtensionRunnerInjectionTest);
	void test("resolves skill summary names from skill headings", runResolvedSkillNameTest);
	void test("injects only a reminder when the full skill text is still on the active path",
		runReminderInjectionWhenSkillStillInContextTest);
	void test("reinjects the full skill text when it exists only on an inactive branch",
		runFullInjectionWhenSkillExistsOnlyOnInactiveBranchTest);
	void test("injects resolved absolute skill paths", runResolvedPathInjectionTest);
	void test("keeps $ autocomplete when another editor extension installs first",
		runCompositionTest);
	void test("cancels $ autocomplete after skill token space", runAutocompleteCancelAfterSpaceTest);
	void test("cooperates with pi-fzfp editor handshake", runPiFzfpCompatibilityTest);
	void test("styles known skill refs in rendered editor lines", runInlineSkillrefStylingTest);
	void test("does not style autocomplete dropdown rows", runRenderedEditorStylingTest);
});
