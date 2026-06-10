import { visibleWidth } from "@earendil-works/pi-tui";
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { SkillrefsContextMessage } from "../src/models/skillrefs-context-message.ts";
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

function renderSummaryRaw(message, width = 80) {
	const component = renderSkillrefsMessage(message, { expanded: false }, createTheme());
	return component.render(width).filter((line) => line.trim());
}

function renderSummary(message, width = 80) {
	return renderSummaryRaw(message, width).map((line) => line.trim());
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
	void test("parses historical injected_skill blocks", () => {
		const parsed = SkillrefsContextMessage.parse([
			"<environment_context>",
			"<injected_skill ref=\"$day\" path=\"/tmp/day.md\">",
			"Legacy body.",
			"</injected_skill>",
			"</environment_context>",
		].join("\n"));

		assert.equal(parsed?.skills[0]?.ref, "$day");
		assert.equal(parsed?.skills[0]?.path, "/tmp/day.md");
		assert.equal(parsed?.skills[0]?.body, "Legacy body.");
	});

	void test("renders collapsed skill refs with token counts", () => {
		const raw = renderSummaryRaw({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day",
			display: true,
			timestamp: Date.now(),
			details: {
				injectedContent:
					`<environment_context>\n<skill ref="$day">\n# Day Skill\n\nRest.\n</skill>\n</environment_context>`,
				skills: [skill({ tokenCount: 8230 })],
			},
		});
		const rendered = raw.join("\n");
		const header = raw[0];
		assert.ok(header);

		assert.equal(visibleWidth(header), 80);
		assert.match(header, /\(Ctrl\+O to expand\)/u);
		assert.match(rendered, /\$day/u);
		assert.match(rendered, /8\.23k/u);
		assert.doesNotMatch(rendered, /Day Skill/u);
		assert.doesNotMatch(rendered, /Skill:/u);
	});

	void test("renders reminder injections without mode labels", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day",
			display: true,
			timestamp: Date.now(),
			details: {
				injectedContent:
					`<environment_context>\n<skill ref="$day" path="/tmp/day.md">Reminder to use $day</skill>\n</environment_context>`,
				skills: [skill({ mode: "reminder", tokenCount: 36 })],
			},
		}).join("\n");

		assert.match(rendered, /\$day/u);
		assert.match(rendered, /\b36\b/u);
		assert.doesNotMatch(rendered, /Skill reminder:/u);
		assert.doesNotMatch(rendered, /Day Skill/u);
	});

	void test("renders all collapsed skill refs across wrapped rows", () => {
		const rendered = renderSummary({
			role: "custom",
			customType: "pi-skillrefs",
			content: "$day, $night, $code-testing, $improve-codebase-architecture",
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
					{
						ref: "$code-testing",
						label: "Test Rules",
						path: "/tmp/code-testing.md",
						mode: "full",
						tokenCount: 1160,
					},
					{
						ref: "$improve-codebase-architecture",
						label: "Improve Architecture",
						path: "/tmp/improve.md",
						mode: "full",
						tokenCount: 1160,
					},
				],
			},
		}, 72).join("\n");

		assert.match(rendered, /\$day/u);
		assert.match(rendered, /\$night/u);
		assert.match(rendered, /\$code-testing/u);
		assert.match(rendered, /\$improve-codebase-architecture/u);
		assert.doesNotMatch(rendered, /Improve Architecture/u);
	});

	void test("renders injected content when expanded", () => {
		const injectedContent =
			`<environment_context>\n<skill ref="$day" path="/tmp/day.md">Reminder to use $day</skill>\n</environment_context>`;
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

		const text = rendered.join("\n");
		assert.match(text, /\$day/u);
		assert.match(text, /\b36\b/u);
		assert.match(text, /<environment_context>/u);
		assert.match(text, /<skill ref="\$day" path="\/tmp\/day\.md">/u);
		assert.doesNotMatch(text, /Day Skill/u);
	});
});
