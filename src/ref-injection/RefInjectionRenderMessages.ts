import { firstPostCompactionContextMessageIndex } from "./CompactionBoundary.js";
import type {
	RefInjectionAdapter,
} from "./RefInjectionAdapter.js";
import type { RefRenderSource } from "./RefInjectionRenderBaseline.js";

export type RefInjectionRenderMessagesInput<TMessage, TBranchEntry> = {
	adapter: RefInjectionAdapter<TMessage, TBranchEntry>;
	messages: readonly TMessage[] | undefined;
	branch: readonly TBranchEntry[];
	text: string;
	renderIndex: number;
	source: RefRenderSource;
};

type RefInjectionRenderMessages<TMessage> = {
	messages: readonly TMessage[] | undefined;
	source: RefRenderSource;
};

export function refInjectionRenderMessages<TMessage, TBranchEntry>(
	input: RefInjectionRenderMessagesInput<TMessage, TBranchEntry>,
): RefInjectionRenderMessages<TMessage> {
	if (!input.messages) {
		return { messages: undefined, source: input.source };
	}
	if (input.source === "history") {
		return { messages: input.messages, source: "history" };
	}

	const compactStart = firstPostCompactionContextMessageIndex(input.adapter, input.branch);
	const compactMessages = input.messages.slice(compactStart);
	const lastMessage = input.messages.at(-1);
	const lastText = lastMessage ? input.adapter.textFromUserMessage(lastMessage) : undefined;
	if (lastText === input.text) {
		return { messages: compactMessages, source: "live" };
	}

	const occurrence = input.messages
		.map((message) => input.adapter.occurrenceFromMessage(message))
		.filter((item) => item !== undefined)[input.renderIndex];
	if (compactStart > 0 && occurrence?.text === input.text) {
		return { messages: input.messages, source: "history" };
	}

	return {
		messages: [...compactMessages, input.adapter.userMessageFromText(input.text)],
		source: "live",
	};
}
