import type { BranchRefInjectionState } from "./BranchRefInjectionState.js";
import { firstPostCompactionRefOccurrenceIndex } from "./CompactionBoundary.js";
import type {
	OrderedRefOccurrenceMemory,
	RefOccurrenceCursor,
} from "./OrderedRefOccurrenceMemory.js";
import type {
	RefInjectionAdapter,
	RefInjectionPlan,
} from "./RefInjectionAdapter.js";

type FinishBranchState<TMessage, TBranchEntry> = (
	memory: OrderedRefOccurrenceMemory<TMessage>,
) => BranchRefInjectionState<TMessage, TBranchEntry>;
type BranchRefInjectionTurnInput<TMessage, TBranchEntry> = {
	adapter: RefInjectionAdapter<TMessage, TBranchEntry>;
	messages: TMessage[];
	branch: readonly TBranchEntry[];
	memory: OrderedRefOccurrenceMemory<TMessage>;
	finishState: FinishBranchState<TMessage, TBranchEntry>;
};

export class BranchRefInjectionTurn<TMessage, TBranchEntry> {
	private readonly adapter: RefInjectionAdapter<TMessage, TBranchEntry>;
	private readonly messages: TMessage[];
	private readonly memory: OrderedRefOccurrenceMemory<TMessage>;
	private readonly cursor: RefOccurrenceCursor;
	private readonly finishState: FinishBranchState<TMessage, TBranchEntry>;
	private readonly firstInjectableOccurrenceIndex: number;
	private recordContextRefs: boolean;
	private occurrenceIndex = 0;

	constructor(input: BranchRefInjectionTurnInput<TMessage, TBranchEntry>) {
		this.adapter = input.adapter;
		this.messages = input.messages;
		this.memory = input.memory;
		this.finishState = input.finishState;
		this.cursor = input.memory.cursorForMessages({
			messages: input.messages,
			messageInput: (message) => input.adapter.occurrenceFromMessage(message),
			textInput: (text) => input.adapter.occurrenceFromText(text),
		});
		this.firstInjectableOccurrenceIndex = firstPostCompactionRefOccurrenceIndex(
			input.adapter,
			input.branch,
		);
		this.recordContextRefs = this.firstInjectableOccurrenceIndex === 0;
	}

	planUserMessage(message: TMessage, index: number): RefInjectionPlan {
		const text = this.adapter.textFromUserMessage(message);
		if (!text || !this.adapter.occurrenceFromText(text)) {
			this.recordContextMessage(message);
			return { action: "none" };
		}

		const occurrence = this.cursor.next(text);
		const occurrenceIndex = this.occurrenceIndex;
		this.occurrenceIndex += 1;
		if (occurrenceIndex < this.firstInjectableOccurrenceIndex) {
			return { action: "skip" };
		}
		this.recordContextRefs = true;
		if (this.adapter.isInjectedMessage(this.messages[index + 1])) {
			return { action: "alreadyInjected" };
		}

		return {
			action: "inject",
			occurrenceId: occurrence.id,
			text,
			refs: occurrence.refs,
			fullRefsBefore: occurrence.refsBefore,
		};
	}

	recordContextMessage(message: TMessage): void {
		if (!this.recordContextRefs) {
			return;
		}

		this.memory.recordFullRefs(this.adapter.fullRefsFromMessage(message));
	}

	recordInjection(plan: Extract<RefInjectionPlan, { action: "inject" }>, message: unknown): void {
		this.memory.recordSuccessfulFullRefs(
			plan.occurrenceId,
			this.adapter.fullRefsFromMessage(message),
		);
	}

	finish(): BranchRefInjectionState<TMessage, TBranchEntry> {
		return this.finishState(this.memory);
	}
}
