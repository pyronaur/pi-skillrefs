import type { EventBus } from "@mariozechner/pi-coding-agent";
import type { AutocompleteProvider } from "@mariozechner/pi-tui";

export type WrapAutocomplete = (provider: AutocompleteProvider) => AutocompleteProvider;

function isWrapAutocomplete(value: unknown): value is WrapAutocomplete {
	return typeof value === "function";
}

export function registerPiFzfpCompatibility(
	pi: { events: Pick<EventBus, "on"> },
	setWrapAutocomplete: (wrapAutocomplete: WrapAutocomplete) => void,
): void {
	pi.events.on("pi-fzfp:check-editor", (ack) => {
		if (typeof ack !== "function") {
			return;
		}

		ack();
	});

	pi.events.on("pi-fzfp:provider", (wrapAutocomplete) => {
		if (!isWrapAutocomplete(wrapAutocomplete)) {
			return;
		}

		setWrapAutocomplete(wrapAutocomplete);
	});
}
