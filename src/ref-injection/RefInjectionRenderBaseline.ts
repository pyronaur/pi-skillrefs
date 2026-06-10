import type { RefOccurrenceInput } from "./RefInjectionAdapter.js";

export type RefRenderSource = "history" | "live";

type BuildRefInjectionMessage = (
	text: string,
	fullRefs: Set<string>,
) => Promise<unknown>;

type RefRenderBaselineRequest<TMessage> = {
	messages: readonly TMessage[] | undefined;
	text: string;
	renderIndex: number;
	source: RefRenderSource;
	knownFullRefs: ReadonlySet<string>;
	fallbackFullRefs: ReadonlySet<string>;
	occurrenceFromMessage(message: TMessage): RefOccurrenceInput | undefined;
	fullRefsFromMessage(message: unknown): Iterable<string>;
	isInjectedMessage(message: unknown): boolean;
	buildMessage: BuildRefInjectionMessage;
};

type ReplayFullRefsRequest<TMessage> = {
	baseline: RefRenderBaselineRequest<TMessage>;
	messageIndex: number;
	text: string;
	fullRefs: Set<string>;
};

function targetOccurrenceIndex<TMessage>(
	request: RefRenderBaselineRequest<TMessage>,
	occurrences: readonly RefOccurrenceInput[],
): number {
	if (request.source === "history") {
		return request.renderIndex;
	}

	for (let index = occurrences.length - 1; index >= 0; index -= 1) {
		if (occurrences[index]?.text === request.text) {
			return index;
		}
	}
	return -1;
}

function recordFullRefs<TMessage>(
	request: RefRenderBaselineRequest<TMessage>,
	fullRefs: Set<string>,
	message: unknown,
): void {
	for (const ref of request.fullRefsFromMessage(message)) {
		fullRefs.add(ref);
	}
}

async function recordReplayFullRefs<TMessage>(
	request: ReplayFullRefsRequest<TMessage>,
): Promise<void> {
	const nextMessage = request.baseline.messages?.[request.messageIndex + 1];
	if (request.baseline.isInjectedMessage(nextMessage)) {
		recordFullRefs(request.baseline, request.fullRefs, nextMessage);
		return;
	}

	recordFullRefs(
		request.baseline,
		request.fullRefs,
		await request.baseline.buildMessage(request.text, new Set(request.fullRefs)),
	);
}

async function fullRefsBeforeTarget<TMessage>(
	request: RefRenderBaselineRequest<TMessage>,
	targetIndex: number,
): Promise<Set<string>> {
	const fullRefs = new Set(request.knownFullRefs);
	let occurrenceIndex = 0;
	for (const [index, message] of request.messages?.entries() ?? []) {
		const occurrence = request.occurrenceFromMessage(message);
		if (!occurrence) {
			recordFullRefs(request, fullRefs, message);
			continue;
		}
		if (occurrenceIndex === targetIndex) {
			return new Set(fullRefs);
		}

		await recordReplayFullRefs({
			baseline: request,
			messageIndex: index,
			text: occurrence.text,
			fullRefs,
		});
		occurrenceIndex += 1;
	}

	return new Set(fullRefs);
}

export async function refInjectionRenderFullRefs<TMessage>(
	request: RefRenderBaselineRequest<TMessage>,
): Promise<Set<string>> {
	if (!request.messages) {
		return new Set(request.fallbackFullRefs);
	}

	const targetIndex = targetOccurrenceIndex(
		request,
		request.messages
			.map((message) => request.occurrenceFromMessage(message))
			.filter((item) => item !== undefined),
	);
	if (targetIndex < 0) {
		return new Set(request.fallbackFullRefs);
	}

	return fullRefsBeforeTarget(request, targetIndex);
}
