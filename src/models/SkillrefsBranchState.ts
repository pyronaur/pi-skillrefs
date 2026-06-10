import type { ContextEvent, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { RefRenderSource } from "../ref-injection/RefInjectionRenderBaseline.js";
import {
	type SkillrefsBranchRefInjectionState,
	type SkillrefsBranchRefInjectionTurn,
	skillrefsRefInjection,
	type SkillrefsRenderBuildContext,
} from "./SkillrefsRefInjection.js";

export type SkillrefsRenderSource = RefRenderSource;

type ContextMessage = ContextEvent["messages"][number];
type RenderBaseline = {
	knownFullRefs: Set<string>;
	fallbackFullRefs: ReadonlySet<string>;
};
type PreparedRenderFullRefs = {
	fullRefsFor(input: {
		messages: ContextEvent["messages"] | undefined;
		buildContext: SkillrefsRenderBuildContext;
	}): Promise<Set<string>>;
};

export class SkillrefsBranchState {
	private readonly state: SkillrefsBranchRefInjectionState;

	private constructor(state: SkillrefsBranchRefInjectionState) {
		this.state = state;
	}

	static empty(): SkillrefsBranchState {
		return new SkillrefsBranchState(skillrefsRefInjection.state.empty());
	}

	static fromRefInjectionState(
		state: SkillrefsBranchRefInjectionState,
	): SkillrefsBranchState {
		return new SkillrefsBranchState(state);
	}

	static fromMessages(
		messages: Iterable<ContextMessage>,
		knownFullRefs: Iterable<string> = [],
		branch?: readonly SessionEntry[],
	): SkillrefsBranchState {
		return new SkillrefsBranchState(
			skillrefsRefInjection.state.fromMessages({
				messages,
				...(branch === undefined ? {} : { branch }),
				seedFullRefs: knownFullRefs,
			}),
		);
	}

	replayForMessages(messages: Iterable<ContextMessage>): SkillrefsBranchState {
		return new SkillrefsBranchState(
			skillrefsRefInjection.state.replayForMessages(this.state, messages),
		);
	}

	beginProviderContext(
		messages: ContextEvent["messages"],
		branch: readonly SessionEntry[],
	): SkillrefsBranchRefInjectionTurn {
		return skillrefsRefInjection.provider.beginTurn(this.state, messages, branch);
	}

	renderBaseline(index: number, text: string): RenderBaseline {
		const baseline = skillrefsRefInjection.state.renderBaseline(this.state, index, text);
		return {
			knownFullRefs: baseline.knownFullRefs,
			fallbackFullRefs: baseline.refsBefore,
		};
	}

	prepareRenderFullRefs(input: {
		index: number;
		text: string;
		source: SkillrefsRenderSource;
	}): PreparedRenderFullRefs {
		const baseline = this.renderBaseline(input.index, input.text);
		return {
			fullRefsFor: (request) =>
				skillrefsRefInjection.render.fullRefsFor({
					messages: request.messages,
					text: input.text,
					renderIndex: input.index,
					source: input.source,
					knownFullRefs: baseline.knownFullRefs,
					fallbackFullRefs: baseline.fallbackFullRefs,
					buildContext: request.buildContext,
				}),
		};
	}
}
