import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { renderSkillrefsMessage } from "../src/render-skillrefs-message.ts";

function createTheme() {
	return {
		fg(_color, text) {
			return text;
		},
		bg(_color, text) {
			return text;
		},
	};
}

function renderSummary(message) {
	const component = renderSkillrefsMessage(message, { expanded: false }, createTheme());
	return component.render(80).map((line) => line.trim()).filter(Boolean);
}

function renderExpanded(message) {
	const component = renderSkillrefsMessage(message, { expanded: true }, createTheme());
	return component.render(120).map((line) => line.trim()).filter(Boolean);
}

function skill(overrides = {}) {
	return {
		ref: "$day",
		label: "Day Skill",
		path: "/tmp/day.md",
		mode: "full",
		tokenCount: 10,
		...overrides,
	};
}

void describe("render-skillrefs-message", () => {
	void test("renders collapsed skill summaries with token counts", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day",
			display: true,
			timestamp: Date.now(),
			details: {
				injectedContent:
					`<environment_context>\n<injected_skill ref="$day">\n# Day Skill\n\nRest.\n</injected_skill>\n</environment_context>`,
				skills: [skill({ tokenCount: 8230 })],
			},
		});

		assert.deepEqual(rendered, ["Skill: Day Skill (8.23k tokens)", "(Ctrl+O to expand)"]);
	});

	void test("renders reminder titles for reminder injections", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day",
			display: true,
			timestamp: Date.now(),
			details: {
				injectedContent:
					`<environment_context>\n<injected_skill ref="$day" path="/tmp/day.md">Reminder to use $day</injected_skill>\n</environment_context>`,
				skills: [skill({ mode: "reminder", tokenCount: 36 })],
			},
		});

		assert.deepEqual(rendered, ["Skill reminder: Day Skill (36 tokens)", "(Ctrl+O to expand)"]);
	});

	void test("renders multiple skills in one collapsed summary", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day, $night",
			display: true,
			timestamp: Date.now(),
			details: {
				skills: [
					skill(),
					{
						ref: "$night",
						label: "Night Skill",
						path: "/tmp/night.md",
						mode: "full",
						tokenCount: 20,
					},
				],
			},
		});

		assert.deepEqual(rendered, [
			"Skill: Day Skill (10 tokens)",
			"Skill: Night Skill (20 tokens)",
			"(Ctrl+O to expand)",
		]);
	});

	void test("renders injected content when expanded", () => {
		const injectedContent =
			`<environment_context>\n<injected_skill ref="$day" path="/tmp/day.md">Reminder to use $day</injected_skill>\n</environment_context>`;
		const rendered = renderExpanded({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day",
			display: true,
			timestamp: Date.now(),
			details: {
				injectedContent,
				skills: [skill({ mode: "reminder", tokenCount: 36 })],
			},
		});

		assert.deepEqual(rendered, [
			"Skill reminder: Day Skill (36 tokens)",
			"<environment_context>",
			`<injected_skill ref="$day" path="/tmp/day.md">Reminder to use $day</injected_skill>`,
			"</environment_context>",
		]);
	});
});
