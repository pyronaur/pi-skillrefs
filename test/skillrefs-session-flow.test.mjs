import {
	fauxAssistantMessage,
	fauxText,
	registerFauxProvider,
} from "@earendil-works/pi-ai";
import {
	AuthStorage,
	createAgentSession,
	DefaultResourceLoader,
	getAgentDir,
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
		`<injected_skill ref="\\${ref}" path="[^"]*">([\\s\\S]*?)<\\/injected_skill>`,
		"gu",
	);
	return [...nextUser.text.matchAll(pattern)].map((match) => match[1] ?? "");
}

function skillModesAfterPrompt(turn, prompt, ref) {
	return injectedSkillBlocksAfterPrompt(turn, prompt, ref).map((body) =>
		body === `Reminder to use ${ref}` ? "reminder" : "full"
	);
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

afterEach(async () => {
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
