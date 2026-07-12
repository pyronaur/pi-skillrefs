import {
	fauxAssistantMessage,
	fauxText,
} from "@earendil-works/pi-ai";
import { registerFauxProvider } from "@earendil-works/pi-ai/compat";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
	InteractiveMode,
	ModelRegistry,
	SessionManager,
	SettingsManager,
} from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import piSkillrefs from "../src/index.ts";
import {
	createChatHost,
	currentAddMessageToChat,
	restoreInteractiveModePatch,
	waitForRenderedChild,
} from "./support/user-message-augmentation.mjs";

const DAY_SKILL_BODY = "# Day Skill\n\nDAY_SKILL_SENTINEL\n";
const LARGE_COMPACTION_PADDING = `COMPACTION_PADDING_SENTINEL\n${"x".repeat(200 * 1024)}`;
const dirsToRemove = [];

function contentText(content) {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return "";
	}

	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text)
		.join("\n");
}

function captureText(captures, text) {
	return (context) => {
		captures.push(context.messages.map((message) => ({
			role: message.role ?? "",
			text: contentText(message.content),
		})));
		return fauxAssistantMessage(fauxText(text));
	};
}

function injectedSkillBlocksAfterPrompt(turn, prompt, ref) {
	const promptIndex = turn.findLastIndex((message) =>
		message.role === "user" && message.text === prompt
	);
	assert.notEqual(promptIndex, -1);
	const nextUser = turn.slice(promptIndex + 1).find((message) => message.role === "user");
	assert.ok(nextUser);
	const pattern = new RegExp(
		`<skill ref="\\${ref}" path="[^"]*" mode="(full|reminder)">([\\s\\S]*?)<\\/skill>`,
		"gu",
	);
	return [...nextUser.text.matchAll(pattern)].map((match) => ({
		mode: match[1] ?? "",
		body: match[2] ?? "",
	}));
}

function skillModesAfterPrompt(turn, prompt, ref) {
	return injectedSkillBlocksAfterPrompt(turn, prompt, ref).map((block) => block.mode);
}

function lastProviderTurn(captures) {
	const turn = captures.at(-1);
	assert.ok(turn);
	return turn;
}

function textFromSessionEntry(entry) {
	if (entry.type !== "message" || entry.message.role !== "user") {
		return undefined;
	}

	return contentText(entry.message.content);
}

function userEntryId(sessionManager, text) {
	const entry = sessionManager.getEntries().find((candidate) =>
		textFromSessionEntry(candidate) === text
	);
	assert.ok(entry);
	return entry.id;
}

function installCompactionExtension(pi, firstKeptPrefix) {
	pi.on("session_before_compact", (event) => {
		const firstKeptEntry = event.branchEntries.slice().reverse().find((entry) =>
			textFromSessionEntry(entry)?.startsWith(firstKeptPrefix)
		);
		assert.ok(firstKeptEntry);
		return {
			compaction: {
				summary: "COMPACTION_SUMMARY_SENTINEL",
				firstKeptEntryId: firstKeptEntry.id,
				tokensBefore: event.preparation.tokensBefore,
				details: { source: "pi-skillrefs-test" },
			},
		};
	});
}

function installTreeSummaryExtension(pi) {
	pi.on("session_before_tree", (event) =>
		event.preparation.userWantsSummary
			? {
				summary: {
					summary: "TREE_SUMMARY_SENTINEL",
					details: { source: "pi-skillrefs-session-flow-test" },
				},
			}
			: undefined);
}

async function createSkillProject() {
	const cwd = await mkdtemp(join(tmpdir(), "pi-skillrefs-session-"));
	dirsToRemove.push(cwd);
	const skillDir = join(cwd, "skills", "day");
	await mkdir(skillDir, { recursive: true });
	await writeFile(
		join(skillDir, "SKILL.md"),
		`---\nname: day\ndescription: Day skill for tests\n---\n\n${DAY_SKILL_BODY}`,
		"utf8",
	);
	return { cwd, skillDir };
}

const TEST_UI_THEME = {
	bg(color, text) {
		return `<bg:${color}>${text}</bg:${color}>`;
	},
	bold(text) {
		return `<bold>${text}</bold>`;
	},
	fg(color, text) {
		return `<${color}>${text}</${color}>`;
	},
};

const BASE_UI_CONTEXT = {
	async select() {
		return undefined;
	},
	async confirm() {
		return false;
	},
	async input() {
		return undefined;
	},
	notify() {},
	onTerminalInput() {
		return () => undefined;
	},
	setStatus() {},
	setWorkingMessage() {},
	setWorkingVisible() {},
	setWorkingIndicator() {},
	setHiddenThinkingLabel() {},
	setWidget() {},
	setFooter() {},
	setHeader() {},
	setTitle() {},
	async custom() {
		return undefined;
	},
	pasteToEditor() {},
	setEditorText() {},
	getEditorText() {
		return "";
	},
	async editor() {
		return undefined;
	},
	addAutocompleteProvider() {},
	theme: TEST_UI_THEME,
	getAllThemes() {
		return [];
	},
	getTheme() {
		return undefined;
	},
	setTheme() {
		return { success: false, error: "not implemented" };
	},
	getToolsExpanded() {
		return true;
	},
	setToolsExpanded() {},
};

function createUiContext() {
	let editorFactory;
	return {
		...BASE_UI_CONTEXT,
		setEditorComponent(factory) {
			editorFactory = factory;
		},
		getEditorComponent() {
			return editorFactory;
		},
	};
}

async function createFlow(options = {}) {
	const project = await createSkillProject();
	const captures = [];
	const faux = registerFauxProvider();
	const model = faux.getModel();
	const authStorage = AuthStorage.inMemory();
	authStorage.setRuntimeApiKey(model.provider, "test-key");
	const settingsManager = SettingsManager.inMemory({
		compaction: {
			enabled: false,
			keepRecentTokens: 1,
			reserveTokens: 1,
		},
	});
	const extensionFactories = options.compactionFirstKeptPrefix
		? [
			piSkillrefs,
			(pi) => installCompactionExtension(pi, options.compactionFirstKeptPrefix),
		]
		: [piSkillrefs];
	if (options.treeSummary) {
		extensionFactories.push(installTreeSummaryExtension);
	}
	const resourceLoader = new DefaultResourceLoader({
		cwd: project.cwd,
		agentDir: getAgentDir(),
		settingsManager,
		extensionFactories,
		additionalSkillPaths: [project.skillDir],
		noExtensions: true,
		noSkills: true,
		noPromptTemplates: true,
		noThemes: true,
		noContextFiles: true,
	});
	await resourceLoader.reload();
	const { session } = await createAgentSession({
		cwd: project.cwd,
		model,
		authStorage,
		modelRegistry: ModelRegistry.inMemory(authStorage),
		settingsManager,
		resourceLoader,
		sessionManager: SessionManager.inMemory(project.cwd),
		noTools: "builtin",
	});
	if (options.hasUI) {
		await session.bindExtensions({ uiContext: createUiContext(), mode: "tui" });
	}
	return {
		captures,
		faux,
		project,
		session,
		async close() {
			session.dispose();
			faux.unregister();
		},
	};
}

function assertNoPersistedSkillrefsMessages(sessionManager) {
	const persisted = sessionManager.getEntries().filter((entry) =>
		entry.type === "custom_message" && entry.customType === "pi-skillrefs"
	);
	assert.deepEqual(persisted, []);
}

async function renderNativeSkillRow(input) {
	currentAddMessageToChat().call(
		input.host,
		{ role: "user", content: input.prompt },
		input.populateHistory ? { populateHistory: true } : undefined,
	);
	return waitForRenderedChild(input.children, input.index, /<skill ref="\$day"/u);
}

afterEach(async () => {
	restoreInteractiveModePatch();
	await Promise.all(dirsToRemove.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

void test("direct sends inject skills through provider context without persisted custom rows", {
	timeout: 5000,
}, async () => {
	const flow = await createFlow();
	flow.faux.setResponses([captureText(flow.captures, "ASSISTANT_DIRECT_SENTINEL")]);

	try {
		await flow.session.prompt("Use $day");

		assert.deepEqual(skillModesAfterPrompt(lastProviderTurn(flow.captures), "Use $day", "$day"), [
			"full",
		]);
		assertNoPersistedSkillrefsMessages(flow.session.sessionManager);
	} finally {
		await flow.close();
	}
});

void test("compaction resets skill refs so the next successful mention injects full", {
	timeout: 5000,
}, async () => {
	const flow = await createFlow({ compactionFirstKeptPrefix: "Before compact $day" });
	flow.faux.setResponses([
		captureText(flow.captures, "ASSISTANT_PRE_COMPACT_DAY_1_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_PRE_COMPACT_PADDING_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_PRE_COMPACT_DAY_2_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_POST_COMPACT_DAY_1_SENTINEL"),
	]);

	try {
		await flow.session.prompt("Before compact $day");
		await flow.session.prompt(LARGE_COMPACTION_PADDING);
		await flow.session.prompt("Before compact again $day");
		await flow.session.compact();
		await flow.session.prompt("After compact $day");

		assert.deepEqual(skillModesAfterPrompt(flow.captures[0], "Before compact $day", "$day"), [
			"full",
		]);
		assert.deepEqual(skillModesAfterPrompt(flow.captures[2], "Before compact again $day", "$day"), [
			"reminder",
		]);
		assert.deepEqual(skillModesAfterPrompt(flow.captures[3], "After compact $day", "$day"), [
			"full",
		]);
	} finally {
		await flow.close();
	}
});

void test("historical native full skill rows remain full after compaction chat rebuild", {
	timeout: 5000,
}, async () => {
	Reflect.set(InteractiveMode.prototype, "addMessageToChat", () => undefined);
	const firstPrompt = "Before compact $day";
	const repeatPrompt = "Before compact again $day";
	const flow = await createFlow({
		compactionFirstKeptPrefix: firstPrompt,
		hasUI: true,
	});
	const live = createChatHost({ expanded: true });
	flow.faux.setResponses([
		captureText(flow.captures, "ASSISTANT_PRE_COMPACT_DAY_1_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_PRE_COMPACT_DAY_2_SENTINEL"),
	]);

	try {
		const firstLiveRow = await renderNativeSkillRow({
			host: live.host,
			children: live.children,
			index: 0,
			prompt: firstPrompt,
		});
		await flow.session.prompt(firstPrompt);
		await renderNativeSkillRow({
			host: live.host,
			children: live.children,
			index: 1,
			prompt: repeatPrompt,
		});
		await flow.session.prompt(repeatPrompt);
		await flow.session.compact();

		const history = createChatHost({ expanded: true });
		const firstHistoryRow = await renderNativeSkillRow({
			host: history.host,
			children: history.children,
			index: 0,
			prompt: firstPrompt,
		});
		await renderNativeSkillRow({
			host: history.host,
			children: history.children,
			index: 1,
			prompt: repeatPrompt,
		});

		assert.match(firstLiveRow, /DAY_SKILL_SENTINEL/u);
		assert.match(firstHistoryRow, /DAY_SKILL_SENTINEL/u);
	} finally {
		await flow.close();
	}
});

void test("native skill rows match provider full mode after compaction", {
	timeout: 5000,
}, async () => {
	Reflect.set(InteractiveMode.prototype, "addMessageToChat", () => undefined);
	const firstPrompt = "Before compact $day";
	const postCompactPrompt = "After compact $day";
	const flow = await createFlow({
		compactionFirstKeptPrefix: firstPrompt,
		hasUI: true,
	});
	const { children, host } = createChatHost({ expanded: true });
	flow.faux.setResponses([
		captureText(flow.captures, "ASSISTANT_PRE_COMPACT_DAY_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_POST_COMPACT_DAY_SENTINEL"),
	]);

	try {
		await flow.session.prompt(firstPrompt);
		await flow.session.compact();

		const visualContext = await renderNativeSkillRow({
			host,
			children,
			index: 0,
			prompt: postCompactPrompt,
		});
		await flow.session.prompt(postCompactPrompt);
		const providerBlocks = injectedSkillBlocksAfterPrompt(
			lastProviderTurn(flow.captures),
			postCompactPrompt,
			"$day",
		);

		assert.equal(providerBlocks.length, 1);
		assert.match(providerBlocks[0]?.body ?? "", /DAY_SKILL_SENTINEL/u);
		assert.match(visualContext, /DAY_SKILL_SENTINEL/u);
	} finally {
		await flow.close();
	}
});

void test("tree navigation uses the arrived branch for skill reminder memory", {
	timeout: 5000,
}, async () => {
	const flow = await createFlow();
	flow.faux.setResponses([
		captureText(flow.captures, "ASSISTANT_ROOT_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_DEPARTED_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_ARRIVED_SENTINEL"),
	]);

	try {
		await flow.session.prompt("Root prompt");
		const rootEntryId = userEntryId(flow.session.sessionManager, "Root prompt");
		await flow.session.prompt("Departed branch $day");
		await flow.session.navigateTree(rootEntryId, { summarize: false });
		await flow.session.prompt("Arrived branch $day");

		assert.deepEqual(
			skillModesAfterPrompt(lastProviderTurn(flow.captures), "Arrived branch $day", "$day"),
			["full"],
		);
	} finally {
		await flow.close();
	}
});

void test("native skill rows match provider reminder mode after summarized tree navigation", {
	timeout: 5000,
}, async () => {
	Reflect.set(InteractiveMode.prototype, "addMessageToChat", () => undefined);
	const initialPrompt = "Initial branch $day";
	const postCompactPrompt = "Post compact $day";
	const repeatedPrompt = "After summary $day";
	const flow = await createFlow({
		compactionFirstKeptPrefix: initialPrompt,
		hasUI: true,
		treeSummary: true,
	});
	const { children, host } = createChatHost({ expanded: true });
	flow.faux.setResponses([
		captureText(flow.captures, "ASSISTANT_FIRST_DAY_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_ABANDONED_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_POST_COMPACT_DAY_SENTINEL"),
		captureText(flow.captures, "ASSISTANT_AFTER_SUMMARY_DAY_SENTINEL"),
	]);

	try {
		await flow.session.prompt(initialPrompt);
		const firstAssistantEntry = flow.session.sessionManager.getEntries().find((entry) =>
			entry.type === "message"
			&& entry.message.role === "assistant"
			&& contentText(entry.message.content) === "ASSISTANT_FIRST_DAY_SENTINEL"
		);
		assert.ok(firstAssistantEntry);
		await flow.session.prompt("Abandoned branch");
		await flow.session.compact();
		await flow.session.prompt(postCompactPrompt);
		await flow.session.navigateTree(firstAssistantEntry.id, { summarize: true });

		const visualContext = await renderNativeSkillRow({
			host,
			children,
			index: 0,
			prompt: repeatedPrompt,
		});
		await flow.session.prompt(repeatedPrompt);
		const providerBlocks = injectedSkillBlocksAfterPrompt(
			lastProviderTurn(flow.captures),
			repeatedPrompt,
			"$day",
		);

		assert.equal(providerBlocks.length, 1);
		assert.doesNotMatch(providerBlocks[0]?.body ?? "", /DAY_SKILL_SENTINEL/u);
		assert.match(visualContext, /<skill ref="\$day"/u);
		assert.doesNotMatch(visualContext, /DAY_SKILL_SENTINEL/u);
	} finally {
		await flow.close();
	}
});
