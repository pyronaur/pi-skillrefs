import { BranchRefInjectionTurn } from "./BranchRefInjectionTurn.js";
import { firstPostCompactionContextMessageIndex } from "./CompactionBoundary.js";
import { OrderedRefOccurrenceMemory } from "./OrderedRefOccurrenceMemory.js";
import type {
	RefInjectionAdapter,
	RefRenderBaseline,
} from "./RefInjectionAdapter.js";

export class BranchRefInjectionState<TMessage, TBranchEntry> {
	private readonly adapter: RefInjectionAdapter<TMessage, TBranchEntry>;
	private readonly memory: OrderedRefOccurrenceMemory<TMessage>;

	constructor(
		adapter: RefInjectionAdapter<TMessage, TBranchEntry>,
		memory: OrderedRefOccurrenceMemory<TMessage> = OrderedRefOccurrenceMemory.empty(),
	) {
		this.adapter = adapter;
		this.memory = memory;
	}

	static empty<TMessage, TBranchEntry>(
		adapter: RefInjectionAdapter<TMessage, TBranchEntry>,
	): BranchRefInjectionState<TMessage, TBranchEntry> {
		return new BranchRefInjectionState(adapter);
	}

	static fromMessages<TMessage, TBranchEntry>(input: {
		adapter: RefInjectionAdapter<TMessage, TBranchEntry>;
		messages: Iterable<TMessage>;
		branch?: readonly TBranchEntry[];
		seedFullRefs?: Iterable<string>;
	}): BranchRefInjectionState<TMessage, TBranchEntry> {
		const messages = [...input.messages].slice(
			firstPostCompactionContextMessageIndex(input.adapter, input.branch),
		);
		const memoryInput = {
			messages,
			messageInput: (message: TMessage) => input.adapter.occurrenceFromMessage(message),
			messageRefs: (message: TMessage) => input.adapter.fullRefsFromMessage(message),
			...(input.seedFullRefs === undefined ? {} : { seedFullRefs: input.seedFullRefs }),
		};
		return new BranchRefInjectionState(
			input.adapter,
			OrderedRefOccurrenceMemory.fromMessages(memoryInput),
		);
	}

	replayForMessages(messages: Iterable<TMessage>): BranchRefInjectionState<TMessage, TBranchEntry> {
		return new BranchRefInjectionState(
			this.adapter,
			this.memory.replay(
				messages,
				(message) => this.adapter.occurrenceFromMessage(message),
				(message) => this.adapter.fullRefsFromMessage(message),
			),
		);
	}

	beginTurn(input: {
		messages: TMessage[];
		branch: readonly TBranchEntry[];
	}): BranchRefInjectionTurn<TMessage, TBranchEntry> {
		return new BranchRefInjectionTurn({
			adapter: this.adapter,
			messages: input.messages,
			branch: input.branch,
			memory: this.memory.clone(),
			finishState: (memory) => new BranchRefInjectionState(this.adapter, memory),
		});
	}

	renderBaseline(index: number, text: string): RefRenderBaseline {
		return {
			knownFullRefs: this.memory.fullRefsSnapshot(),
			refsBefore: this.memory.occurrenceForRender(
				index,
				text,
				(input) => this.adapter.occurrenceFromText(input),
			).refsBefore,
		};
	}
}
