import {
	buildSessionContext,
	type ContextEvent,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";

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
