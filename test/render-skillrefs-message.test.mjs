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
			content: `<injected_skill ref="$day">\n# Day Skill\n\nRest.\n</injected_skill>`,
			display: true,
			timestamp: Date.now(),
			details: {
				skill: { ref: "$day", label: "Day Skill", tokenCount: 8230 },
			},
		});

		assert.deepEqual(rendered, ["Skill: Day Skill (8.23k tokens)", "(Ctrl+O to expand)"]);
	});

	void test("renders reminder titles for reminder injections", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "skillrefs",
			content:
				`<injected_skill ref="$day" path="/tmp/day.md">Reminder to use $day</injected_skill>`,
			display: true,
			timestamp: Date.now(),
			details: {
				skill: {
					ref: "$day",
					label: "Day Skill",
					path: "/tmp/day.md",
					mode: "reminder",
					tokenCount: 36,
				},
			},
		});

		assert.deepEqual(rendered, ["Skill reminder: Day Skill (36 tokens)", "(Ctrl+O to expand)"]);
	});
});
