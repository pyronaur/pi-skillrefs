import type { MessageRenderer } from "@earendil-works/pi-coding-agent";
import type { SkillrefsMessageDetails } from "./models/SkillrefsCustomMessage.js";
import { skillrefsRefInjection } from "./models/SkillrefsRefInjection.js";

export const renderSkillrefsMessage: MessageRenderer<SkillrefsMessageDetails> = (
	message,
	options,
	theme,
) => skillrefsRefInjection.renderer.renderComponent(message, options.expanded, theme);
