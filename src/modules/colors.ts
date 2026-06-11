import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { type TString, Type } from "typebox";
import { Check, Clean } from "typebox/value";

const HEX_COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/u;
const ANSI_STYLE = {
	foreground: { code: "38", reset: "39" },
	background: { code: "48", reset: "49" },
} as const;

type AnsiStyle = keyof typeof ANSI_STYLE;
type ColorName<TColors extends Record<string, string>> = Extract<keyof TColors, string>;
type ColorFunction = (text: string, theme?: ThemeChannel) => string;
type ColorRenderers = {
	fg: ColorFunction;
	bg: ColorFunction;
};
type ColorTheme<TColors extends Record<string, string>> = {
	[Name in ColorName<TColors>]: ColorRenderers;
};
type ThemeChannel = {
	fg(color: string, text: string): string;
	bg(color: string, text: string): string;
};

function ansi(style: AnsiStyle, colorValue: string, text: string): string {
	const { code, reset } = ANSI_STYLE[style];
	const red = Number.parseInt(colorValue.slice(1, 3), 16);
	const green = Number.parseInt(colorValue.slice(3, 5), 16);
	const blue = Number.parseInt(colorValue.slice(5, 7), 16);
	return `\x1b[${code};2;${red};${green};${blue}m${text}\x1b[${reset}m`;
}

export default function createTheme<const TColors extends Record<string, string>>(
	extensionName: string,
	defaults: TColors,
): ColorTheme<TColors> {
	const colorProperties: Record<string, TString> = {};
	const unknownColorProperties = Object.fromEntries(
		Object.keys(defaults).map((name) => [name, Type.Unknown()]),
	);
	for (const [name, value] of Object.entries(defaults)) {
		colorProperties[name] = Type.String({ default: value });
	}

	const ColorsSchema = Type.Object(colorProperties, { additionalProperties: false });
	const OverridesSchema = Type.Partial(Type.Object(unknownColorProperties, {
		additionalProperties: false,
	}));
	let cachedPath = "";
	let cachedColors: Readonly<Record<string, string>> | undefined;

	function readColors(path: string): Readonly<Record<string, string>> {
		const colors: Record<string, string> = { ...defaults };
		try {
			const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
			const cleaned = Clean(OverridesSchema, raw);
			if (!Check(OverridesSchema, cleaned)) {
				return colors;
			}

			for (const [name, colorSchema] of Object.entries(ColorsSchema.properties)) {
				const value = cleaned[name];
				if (Check(colorSchema, value)) {
					colors[name] = value;
				}
			}
		} catch {
			return colors;
		}
		return colors;
	}

	function themeColors(): Readonly<Record<string, string>> {
		const path = join(getAgentDir(), extensionName, "theme.json");
		if (cachedColors && cachedPath === path) {
			return cachedColors;
		}

		cachedPath = path;
		cachedColors = readColors(path);
		return cachedColors;
	}

	const theme: ColorTheme<TColors> = Object.create(null);
	for (const name in defaults) {
		function colorValue(): string {
			return themeColors()[name] ?? defaults[name] ?? "";
		}
		theme[name] = {
			fg(text, theme): string {
				const value = colorValue();
				return HEX_COLOR_PATTERN.test(value)
					? ansi("foreground", value, text)
					: theme?.fg(value, text) ?? text;
			},
			bg(text, theme): string {
				const value = colorValue();
				return HEX_COLOR_PATTERN.test(value)
					? ansi("background", value, text)
					: theme?.bg(value, text) ?? text;
			},
		};
	}
	return theme;
}
