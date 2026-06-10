import {
	buildSessionContext,
	type ContextEvent,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { SkillrefsRenderSource } from "./models/SkillrefsBranchState.js";

type ContextMessage = ContextEvent["messages"][number];
type ContextUserMessage = Extract<ContextMessage, { role: "user" }>;

export function sessionContextMessages(
	ctx: ExtensionContext,
): ContextEvent["messages"] | undefined {
	const sessionManager = ctx.sessionManager;
	if (
		!sessionManager
		|| typeof sessionManager.getEntries !== "function"
		|| typeof sessionManager.getLeafId !== "function"
	) {
		return undefined;
	}

	return buildSessionContext(
		sessionManager.getEntries(),
		sessionManager.getLeafId(),
	).messages;
}

export function contextMessagesForSkillrefsRender(
	ctx: ExtensionContext,
	input: {
		text: string;
		source: SkillrefsRenderSource;
	},
): ContextEvent["messages"] | undefined {
	const messages = sessionContextMessages(ctx);
	if (!messages || input.source === "history") {
		return messages;
	}

	const lastMessage = messages.at(-1);
	if (
		lastMessage?.role === "user"
		&& typeof lastMessage.content === "string"
		&& lastMessage.content === input.text
	) {
		return messages;
	}

	const currentMessage: ContextUserMessage = {
		role: "user",
		content: input.text,
		timestamp: Date.now(),
	};
	return [...messages, currentMessage];
}
