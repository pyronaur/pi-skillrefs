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

void describe("render-skillrefs-message", () => {
	void test("renders collapsed skill summaries with token counts", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "skillrefs",
			content:
				`<environment_context>\n<injected_skill ref="$day">\n# Day Skill\n\nRest.\n</injected_skill>\n</environment_context>`,
			display: true,
			timestamp: Date.now(),
			details: {
				skills: [{ ref: "$day", label: "Day Skill", tokenCount: 8230 }],
			},
		});

		assert.deepEqual(rendered, ["Skill: Day Skill (8.23k tokens)", "(Ctrl+O to expand)"]);
	});

	void test("renders reminder titles for reminder injections", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "skillrefs",
			content:
				`<environment_context>\n<injected_skill ref="$day" path="/tmp/day.md">Reminder to use $day</injected_skill>\n</environment_context>`,
			display: true,
			timestamp: Date.now(),
			details: {
				skills: [{
					ref: "$day",
					label: "Day Skill",
					path: "/tmp/day.md",
					mode: "reminder",
					tokenCount: 36,
				}],
			},
		});

		assert.deepEqual(rendered, ["Skill reminder: Day Skill (36 tokens)", "(Ctrl+O to expand)"]);
	});

	void test("renders multiple skills in one collapsed summary", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "skillrefs",
			content:
				`<environment_context>\n<injected_skill ref="$day">\n# Day Skill\n</injected_skill>\n\n<injected_skill ref="$night">\n# Night Skill\n</injected_skill>\n</environment_context>`,
			display: true,
			timestamp: Date.now(),
			details: {
				skills: [
					{ ref: "$day", label: "Day Skill", tokenCount: 10 },
					{ ref: "$night", label: "Night Skill", tokenCount: 20 },
				],
			},
		});

		assert.deepEqual(rendered, [
			"Skill: Day Skill (10 tokens)",
			"Skill: Night Skill (20 tokens)",
			"(Ctrl+O to expand)",
		]);
	});
});
