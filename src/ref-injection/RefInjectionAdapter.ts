export type RefOccurrenceInput = {
	text: string;
	refs: string[];
};

export type RefOccurrence = RefOccurrenceInput & {
	id: number;
	refsBefore: ReadonlySet<string>;
};

export type RefRenderBaseline = {
	knownFullRefs: Set<string>;
	refsBefore: ReadonlySet<string>;
};

export type RefInjectionPlan =
	| { action: "none" }
	| { action: "skip" }
	| { action: "alreadyInjected" }
	| {
		action: "inject";
		occurrenceId: number;
		text: string;
		refs: string[];
		fullRefsBefore: ReadonlySet<string>;
	};

export type RefInjectionAdapter<TMessage, TBranchEntry> = {
	occurrenceFromText(text: string): RefOccurrenceInput | undefined;
	occurrenceFromMessage(message: TMessage): RefOccurrenceInput | undefined;
	textFromUserMessage(message: TMessage): string | undefined;
	userMessageFromText(text: string): TMessage;
	fullRefsFromMessage(message: unknown): Iterable<string>;
	isInjectedMessage(message: unknown): boolean;
	textFromBranchEntry(entry: TBranchEntry): string | undefined;
	branchEntryHasContextMessage(entry: TBranchEntry): boolean;
	branchEntryId(entry: TBranchEntry): string | undefined;
	compactionFirstKeptEntryId(entry: TBranchEntry): string | undefined;
};
