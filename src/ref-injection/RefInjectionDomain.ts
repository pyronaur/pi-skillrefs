import { BranchRefInjectionState } from "./BranchRefInjectionState.js";
import type { BranchRefInjectionTurn } from "./BranchRefInjectionTurn.js";
import type {
	RefInjectionAdapter,
	RefRenderBaseline,
} from "./RefInjectionAdapter.js";
import {
	type RefInjectionContextBlock,
	RefInjectionContextMessage,
	type RefInjectionContextMessageConfig,
} from "./RefInjectionContextMessage.js";
import {
	createRefInjectionCustomMessages,
	type RefInjectionCustomMessageConfig,
	type RefInjectionCustomMessages,
	type RefInjectionDetails,
	type RefInjectionItem,
} from "./RefInjectionCustomMessage.js";
import {
	createRefInjectionMessageRenderer,
	type RefInjectionMessageRenderer,
	type RefInjectionMessageRendererConfig,
} from "./RefInjectionMessageRenderer.js";
import {
	refInjectionRenderFullRefs,
	type RefRenderSource,
} from "./RefInjectionRenderBaseline.js";

type RefInjectionDomainAdapterConfig<TMessage, TBranchEntry> = Omit<
	RefInjectionAdapter<TMessage, TBranchEntry>,
	"fullRefsFromMessage" | "isInjectedMessage"
>;

type RefInjectionDomainRendererConfig<TItem extends RefInjectionItem> = Omit<
	RefInjectionMessageRendererConfig<TItem>,
	"items" | "expandedContent"
>;

type RefInjectionDomainBuildMessageInput<TRenderContext> = {
	text: string;
	fullRefs: Set<string>;
	buildContext: TRenderContext;
};

type RefInjectionDomainRenderFullRefsInput<TMessage, TRenderContext> = {
	messages: readonly TMessage[] | undefined;
	text: string;
	renderIndex: number;
	source: RefRenderSource;
	knownFullRefs: ReadonlySet<string>;
	fallbackFullRefs: ReadonlySet<string>;
	buildContext: TRenderContext;
};

export type RefInjectionDomainConfig<
	TMessage,
	TBranchEntry,
	TCustomType extends string,
	TItemKey extends string,
	TItem extends RefInjectionItem,
	TBlock extends RefInjectionContextBlock,
	TRenderContext,
> = {
	adapter: RefInjectionDomainAdapterConfig<TMessage, TBranchEntry>;
	customMessage: RefInjectionCustomMessageConfig<TCustomType, TItemKey, TItem>;
	contextMessage: RefInjectionContextMessageConfig<TBlock>;
	renderer: RefInjectionDomainRendererConfig<TItem>;
	buildMessage(input: RefInjectionDomainBuildMessageInput<TRenderContext>): Promise<unknown>;
};

export type RefInjectionDomain<
	TMessage,
	TBranchEntry,
	TCustomType extends string,
	TItem extends RefInjectionItem,
	TDetails extends RefInjectionDetails<TItem>,
	TBlock extends RefInjectionContextBlock,
	TRenderContext,
> = {
	state: {
		empty(): BranchRefInjectionState<TMessage, TBranchEntry>;
		fromMessages(input: {
			messages: Iterable<TMessage>;
			branch?: readonly TBranchEntry[];
			seedFullRefs?: Iterable<string>;
		}): BranchRefInjectionState<TMessage, TBranchEntry>;
		replayForMessages(
			state: BranchRefInjectionState<TMessage, TBranchEntry>,
			messages: Iterable<TMessage>,
		): BranchRefInjectionState<TMessage, TBranchEntry>;
		renderBaseline(
			state: BranchRefInjectionState<TMessage, TBranchEntry>,
			index: number,
			text: string,
		): RefRenderBaseline;
	};
	provider: {
		beginTurn(
			state: BranchRefInjectionState<TMessage, TBranchEntry>,
			messages: TMessage[],
			branch: readonly TBranchEntry[],
		): BranchRefInjectionTurn<TMessage, TBranchEntry>;
		finishTurn(
			turn: BranchRefInjectionTurn<TMessage, TBranchEntry>,
		): BranchRefInjectionState<TMessage, TBranchEntry>;
	};
	render: {
		fullRefsFor(
			input: RefInjectionDomainRenderFullRefsInput<TMessage, TRenderContext>,
		): Promise<Set<string>>;
	};
	message: RefInjectionCustomMessages<TCustomType, TItem>;
	context: {
		create(blocks: readonly TBlock[]): RefInjectionContextMessage<TBlock>;
		parse(content: unknown): RefInjectionContextMessage<TBlock> | null;
	};
	renderer: RefInjectionMessageRenderer<TDetails>;
};

class RefInjectionDomainBuilder<
	TMessage,
	TBranchEntry,
	TCustomType extends string,
	TItemKey extends string,
	TItem extends RefInjectionItem,
	TDetails extends RefInjectionDetails<TItem>,
	TBlock extends RefInjectionContextBlock,
	TRenderContext,
> {
	private readonly adapter: RefInjectionAdapter<TMessage, TBranchEntry>;
	private readonly config: RefInjectionDomainConfig<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItemKey,
		TItem,
		TBlock,
		TRenderContext
	>;
	private readonly message: RefInjectionCustomMessages<TCustomType, TItem>;
	private readonly renderer: RefInjectionMessageRenderer<TDetails>;

	constructor(
		config: RefInjectionDomainConfig<
			TMessage,
			TBranchEntry,
			TCustomType,
			TItemKey,
			TItem,
			TBlock,
			TRenderContext
		>,
	) {
		this.config = config;
		this.message = createRefInjectionCustomMessages(config.customMessage);
		this.adapter = {
			...config.adapter,
			fullRefsFromMessage: (input) => this.message.fullRefs(input),
			isInjectedMessage: (input) => this.message.is(input),
		};
		this.renderer = createRefInjectionMessageRenderer<TDetails, TItem>({
			...config.renderer,
			items: (details) => this.message.items(details),
			expandedContent: (content, details) => this.message.expandedContent(content, details),
		});
	}

	build(): RefInjectionDomain<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItem,
		TDetails,
		TBlock,
		TRenderContext
	> {
		return {
			state: this.stateFacade(),
			provider: this.providerFacade(),
			render: this.renderFacade(),
			message: this.message,
			context: this.contextFacade(),
			renderer: this.renderer,
		};
	}

	private stateFacade(): RefInjectionDomain<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItem,
		TDetails,
		TBlock,
		TRenderContext
	>["state"] {
		return {
			empty: () => BranchRefInjectionState.empty(this.adapter),
			fromMessages: (input) =>
				BranchRefInjectionState.fromMessages({
					adapter: this.adapter,
					messages: input.messages,
					...(input.branch === undefined ? {} : { branch: input.branch }),
					...(input.seedFullRefs === undefined ? {} : { seedFullRefs: input.seedFullRefs }),
				}),
			replayForMessages: (state, messages) => state.replayForMessages(messages),
			renderBaseline: (state, index, text) => state.renderBaseline(index, text),
		};
	}

	private providerFacade(): RefInjectionDomain<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItem,
		TDetails,
		TBlock,
		TRenderContext
	>["provider"] {
		return {
			beginTurn: (state, messages, branch) => state.beginTurn({ messages, branch }),
			finishTurn: (turn) => turn.finish(),
		};
	}

	private renderFacade(): RefInjectionDomain<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItem,
		TDetails,
		TBlock,
		TRenderContext
	>["render"] {
		return {
			fullRefsFor: (input) =>
				refInjectionRenderFullRefs({
					messages: input.messages,
					text: input.text,
					renderIndex: input.renderIndex,
					source: input.source,
					knownFullRefs: input.knownFullRefs,
					fallbackFullRefs: input.fallbackFullRefs,
					occurrenceFromMessage: (messageInput) => this.adapter.occurrenceFromMessage(messageInput),
					fullRefsFromMessage: (messageInput) => this.adapter.fullRefsFromMessage(messageInput),
					isInjectedMessage: (messageInput) => this.adapter.isInjectedMessage(messageInput),
					buildMessage: (text, fullRefs) =>
						this.config.buildMessage({
							text,
							fullRefs,
							buildContext: input.buildContext,
						}),
				}),
		};
	}

	private contextFacade(): RefInjectionDomain<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItem,
		TDetails,
		TBlock,
		TRenderContext
	>["context"] {
		return {
			create: (blocks) => RefInjectionContextMessage.create(this.config.contextMessage, blocks),
			parse: (content) => RefInjectionContextMessage.parse(this.config.contextMessage, content),
		};
	}
}

export function createRefInjectionDomain<
	TMessage,
	TBranchEntry,
	TCustomType extends string,
	TItemKey extends string,
	TItem extends RefInjectionItem,
	TDetails extends RefInjectionDetails<TItem>,
	TBlock extends RefInjectionContextBlock,
	TRenderContext,
>(
	config: RefInjectionDomainConfig<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItemKey,
		TItem,
		TBlock,
		TRenderContext
	>,
): RefInjectionDomain<
	TMessage,
	TBranchEntry,
	TCustomType,
	TItem,
	TDetails,
	TBlock,
	TRenderContext
> {
	return new RefInjectionDomainBuilder<
		TMessage,
		TBranchEntry,
		TCustomType,
		TItemKey,
		TItem,
		TDetails,
		TBlock,
		TRenderContext
	>(config).build();
}
