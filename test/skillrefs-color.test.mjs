import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { color } from "../src/colors.ts";

const dirsToRemove = [];
const originalAgentDir = process.env.PI_CODING_AGENT_DIR;

function restoreAgentDir() {
	if (originalAgentDir === undefined) {
		delete process.env.PI_CODING_AGENT_DIR;
		return;
	}

	process.env.PI_CODING_AGENT_DIR = originalAgentDir;
}

function createTheme() {
	const calls = [];
	return {
		calls,
		theme: {
			fg(name, text) {
				calls.push({ method: "fg", color: name, text });
				return `fg:${name}:${text}`;
			},
			bg(name, text) {
				calls.push({ method: "bg", color: name, text });
				return `bg:${name}:${text}`;
			},
		},
	};
}

async function useTempAgentDir() {
	const agentDir = await mkdtemp(join(tmpdir(), "pi-skillrefs-colors-"));
	dirsToRemove.push(agentDir);
	process.env.PI_CODING_AGENT_DIR = agentDir;
	return agentDir;
}

async function writeThemeFile(agentDir, content) {
	const dir = join(agentDir, "pi-skillrefs");
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "theme.json"), content, "utf8");
}

async function writeTheme(agentDir, colors) {
	await writeThemeFile(agentDir, JSON.stringify(colors));
}

afterEach(async () => {
	restoreAgentDir();
	await Promise.all(dirsToRemove.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

void test("skillrefs theme delegates source default tokens to the supplied Pi theme", async () => {
	await useTempAgentDir();
	const { calls, theme } = createTheme();

	assert.equal(color.tag.fg("$day", theme), "fg:customMessageLabel:$day");
	assert.equal(color.container.bg("body", theme), "bg:customMessageBg:body");
	assert.deepEqual(calls, [
		{ method: "fg", color: "customMessageLabel", text: "$day" },
		{ method: "bg", color: "customMessageBg", text: "body" },
	]);
});

void test("skillrefs theme applies flat JSON hex overrides", async () => {
	const agentDir = await useTempAgentDir();
	await writeTheme(agentDir, {
		tag: "#001122",
		container: "#334455",
	});
	const { calls, theme } = createTheme();

	assert.equal(color.tag.fg("$day", theme), "\u001b[38;2;0;17;34m$day\u001b[39m");
	assert.equal(color.container.bg("body", theme), "\u001b[48;2;51;68;85mbody\u001b[49m");
	assert.deepEqual(calls, []);
});

void test("skillrefs theme delegates token overrides to the supplied Pi theme", async () => {
	const agentDir = await useTempAgentDir();
	await writeTheme(agentDir, {
		tag: "accent",
		container: "customMessageBg",
	});
	const { calls, theme } = createTheme();

	assert.equal(color.tag.fg("$day", theme), "fg:accent:$day");
	assert.equal(color.container.bg("body", theme), "bg:customMessageBg:body");
	assert.deepEqual(calls, [
		{ method: "fg", color: "accent", text: "$day" },
		{ method: "bg", color: "customMessageBg", text: "body" },
	]);
});

void test("skillrefs theme ignores unknown keys", async () => {
	const agentDir = await useTempAgentDir();
	await writeTheme(agentDir, {
		unknownColor: "#000000",
		tag: "#001122",
	});
	const { calls, theme } = createTheme();

	assert.equal(color.tag.fg("$day", theme), "\u001b[38;2;0;17;34m$day\u001b[39m");
	assert.deepEqual(calls, []);
});

void test("skillrefs theme falls back per non-string configured entry", async () => {
	const agentDir = await useTempAgentDir();
	await writeTheme(agentDir, {
		tag: 42,
		text: "#001122",
	});
	const { calls, theme } = createTheme();

	assert.equal(color.tag.fg("$day", theme), "fg:customMessageLabel:$day");
	assert.equal(color.text.fg("body", theme), "\u001b[38;2;0;17;34mbody\u001b[39m");
	assert.deepEqual(calls, [{ method: "fg", color: "customMessageLabel", text: "$day" }]);
});

void test("skillrefs theme uses defaults when the theme file is invalid", async () => {
	const agentDir = await useTempAgentDir();
	await writeThemeFile(agentDir, "{");
	const { calls, theme } = createTheme();

	assert.equal(color.tag.fg("$day", theme), "fg:customMessageLabel:$day");
	assert.deepEqual(calls, [{ method: "fg", color: "customMessageLabel", text: "$day" }]);
});
