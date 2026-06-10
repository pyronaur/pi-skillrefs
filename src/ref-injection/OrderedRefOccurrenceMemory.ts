import type { RefOccurrence, RefOccurrenceInput } from "./RefInjectionAdapter.js";

type StoredRefOccurrence = RefOccurrenceInput & {
	refsBefore: Set<string>;
	successfulFullRefs: Set<string>;
};
type MessageInput<TMessage> = (message: TMessage) => RefOccurrenceInput | undefined;
type MessageRefs<TMessage> = (message: TMessage) => Iterable<string>;
type TextInput = (text: string) => RefOccurrenceInput | undefined;
type FromMessagesInput<TMessage> = {
	messages: Iterable<TMessage>;
	messageInput: MessageInput<TMessage>;
	messageRefs: MessageRefs<TMessage>;
	seedFullRefs?: Iterable<string>;
};
type CursorInput<TMessage> = {
	messages: Iterable<TMessage>;
	messageInput: MessageInput<TMessage>;
	textInput: TextInput;
};
export type RefOccurrenceCursor = {
	next(text: string): RefOccurrence;
};

function sameOccurrence(left: RefOccurrenceInput, right: RefOccurrenceInput): boolean {
	return (
		left.text === right.text
		&& left.refs.length === right.refs.length
		&& left.refs.every((ref, index) => ref === right.refs[index])
	);
}

function snapshotOccurrence(occurrence: StoredRefOccurrence, id: number): RefOccurrence {
	return {
		id,
		text: occurrence.text,
		refs: [...occurrence.refs],
		refsBefore: new Set(occurrence.refsBefore),
	};
}

function previewOccurrence(
	input: RefOccurrenceInput,
	refsBefore: ReadonlySet<string>,
): RefOccurrence {
	return {
		id: -1,
		text: input.text,
		refs: [...input.refs],
		refsBefore: new Set(refsBefore),
	};
}

export class OrderedRefOccurrenceMemory<TMessage> {
	private readonly fullRefs: Set<string>;
	private readonly occurrences: StoredRefOccurrence[];

	private constructor(fullRefs: Set<string>, occurrences: StoredRefOccurrence[]) {
		this.fullRefs = fullRefs;
		this.occurrences = occurrences;
	}

	static empty<TMessage>(
		seedFullRefs: Iterable<string> = [],
	): OrderedRefOccurrenceMemory<TMessage> {
		return new OrderedRefOccurrenceMemory(new Set(seedFullRefs), []);
	}

	static fromMessages<TMessage>(
		input: FromMessagesInput<TMessage>,
	): OrderedRefOccurrenceMemory<TMessage> {
		const memory = OrderedRefOccurrenceMemory.empty<TMessage>(input.seedFullRefs);
		for (const message of input.messages) {
			if (input.messageInput(message)) {
				continue;
			}
			memory.recordFullRefs(input.messageRefs(message));
		}
		return memory;
	}

	clone(): OrderedRefOccurrenceMemory<TMessage> {
		return new OrderedRefOccurrenceMemory(
			new Set(this.fullRefs),
			this.occurrences.map((occurrence) => ({
				text: occurrence.text,
				refs: [...occurrence.refs],
				refsBefore: new Set(occurrence.refsBefore),
				successfulFullRefs: new Set(occurrence.successfulFullRefs),
			})),
		);
	}

	replay(
		messages: Iterable<TMessage>,
		messageInput: MessageInput<TMessage>,
		messageRefs: MessageRefs<TMessage>,
	): OrderedRefOccurrenceMemory<TMessage> {
		const memory = OrderedRefOccurrenceMemory.empty<TMessage>();
		let searchStart = 0;
		for (const message of messages) {
			const input = messageInput(message);
			if (!input) {
				memory.recordFullRefs(messageRefs(message));
				continue;
			}

			const matchedIndex = this.occurrences.findIndex((occurrence, index) =>
				index >= searchStart && sameOccurrence(occurrence, input)
			);
			const matched = matchedIndex < 0 ? undefined : this.occurrences[matchedIndex];
			memory.appendOccurrence({
				text: input.text,
				refs: input.refs,
				successfulFullRefs: matched ? new Set(matched.successfulFullRefs) : new Set(),
			});
			if (matched) {
				memory.recordFullRefs(matched.successfulFullRefs);
				searchStart = matchedIndex + 1;
			}
		}
		return memory;
	}

	fullRefsSnapshot(): Set<string> {
		return new Set(this.fullRefs);
	}

	occurrenceForRender(index: number, text: string, textInput: TextInput): RefOccurrence {
		const input = textInput(text);
		const occurrence = this.occurrences[index];
		if (input && occurrence && sameOccurrence(occurrence, input)) {
			return snapshotOccurrence(occurrence, index);
		}

		return previewOccurrence(input ?? { text, refs: [] }, this.fullRefs);
	}

	cursorForMessages(input: CursorInput<TMessage>): RefOccurrenceCursor {
		const inputs = [...input.messages]
			.map(input.messageInput)
			.filter((occurrence) => occurrence !== undefined);
		let index = this.syncOccurrences(inputs);
		const fallbackFullRefs = new Set(this.fullRefs);
		return {
			next: (text) => {
				const occurrenceInput = input.textInput(text);
				const occurrence = this.occurrences[index];
				const occurrenceIndex = index;
				index += 1;
				if (occurrenceInput && occurrence && sameOccurrence(occurrence, occurrenceInput)) {
					return snapshotOccurrence(occurrence, occurrenceIndex);
				}

				if (occurrenceInput) {
					return snapshotOccurrence(
						this.appendOccurrence(occurrenceInput),
						this.occurrences.length - 1,
					);
				}

				return previewOccurrence(occurrenceInput ?? { text, refs: [] }, fallbackFullRefs);
			},
		};
	}

	recordFullRefs(refs: Iterable<string>): void {
		for (const ref of refs) {
			this.fullRefs.add(ref);
		}
	}

	recordSuccessfulFullRefs(id: number, refs: Iterable<string>): void {
		const occurrence = this.occurrences[id];
		const recorded = [...refs];
		if (occurrence) {
			for (const ref of recorded) {
				occurrence.successfulFullRefs.add(ref);
			}
		}
		this.recordFullRefs(recorded);
	}

	private syncOccurrences(inputs: RefOccurrenceInput[]): number {
		if (inputs.length === 0) {
			return this.occurrences.length;
		}

		const matched = this.matchingContextPrefixLength(inputs);
		return this.occurrences.length - matched;
	}

	private matchingContextPrefixLength(inputs: RefOccurrenceInput[]): number {
		const maxLength = Math.min(inputs.length, this.occurrences.length);
		for (let length = maxLength; length > 0; length -= 1) {
			const startIndex = this.occurrences.length - length;
			const matches = inputs
				.slice(0, length)
				.every((input, index) => {
					const occurrence = this.occurrences[startIndex + index];
					return occurrence !== undefined && sameOccurrence(occurrence, input);
				});
			if (matches) {
				return length;
			}
		}
		return 0;
	}

	private appendOccurrence(
		input: RefOccurrenceInput & { successfulFullRefs?: Set<string> },
	): StoredRefOccurrence {
		const occurrence = {
			text: input.text,
			refs: [...input.refs],
			refsBefore: new Set(this.fullRefs),
			successfulFullRefs: input.successfulFullRefs ?? new Set<string>(),
		};
		this.occurrences.push(occurrence);
		return occurrence;
	}
}
