import { InteractiveMode } from "@earendil-works/pi-coding-agent";
import assert from "node:assert/strict";

const originalAddMessageToChat = Reflect.get(InteractiveMode.prototype, "addMessageToChat");

function renderChildText(children, index) {
	const child = children[index];
	assert.ok(child);
	return child.render(120).join("\n");
}

export function restoreInteractiveModePatch() {
	Reflect.set(InteractiveMode.prototype, "addMessageToChat", originalAddMessageToChat);
}

export function currentAddMessageToChat() {
	const method = Reflect.get(InteractiveMode.prototype, "addMessageToChat");
	assert.equal(typeof method, "function");
	return function addMessageToChat(message, options) {
		return method.call(this, message, options);
	};
}

export function createChatHost(options = {}) {
	const children = [];
	return {
		children,
		host: {
			chatContainer: {
				addChild: children.push.bind(children),
			},
			getUserMessageText(message) {
				return message.content;
			},
			keybindings: {
				getKeys(keybinding) {
					assert.equal(keybinding, "app.tools.expand");
					return ["ctrl+o"];
				},
			},
			toolOutputExpanded: options.expanded === true,
			ui: {
				requestRender() {},
			},
		},
	};
}

export async function waitForRenderedChild(children, index, pattern) {
	for (let attempt = 0; attempt < 25; attempt += 1) {
		const text = renderChildText(children, index);
		if (pattern.test(text)) {
			return text;
		}
		await new Promise((resolve) => setTimeout(resolve, 10));
	}

	return renderChildText(children, index);
}
