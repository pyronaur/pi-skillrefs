export type RefInjectionMode = "full" | "reminder";

export type RefInjectionItem = {
	ref: string;
	label: string;
	tokenCount: number;
	mode: RefInjectionMode;
	path?: string;
	command?: string;
};

export type RefInjectionDetails<TItem extends RefInjectionItem> = {
	injectedContent?: string;
	[key: string]: string | TItem[] | undefined;
};

export type RefInjectionCustomMessage<
	TCustomType extends string,
	TItem extends RefInjectionItem,
> = {
	customType: TCustomType;
	content: string;
	display: true;
	details: RefInjectionDetails<TItem>;
};

type RefInjectionSessionMessage<TCustomType extends string> = {
	role: "custom";
	customType: TCustomType;
	content: string;
	details?: { injectedContent?: string };
};

export type RefInjectionCustomMessageConfig<
	TCustomType extends string,
	TItemKey extends string,
	TItem extends RefInjectionItem,
> = {
	customType: TCustomType;
	itemKey: TItemKey;
	isItem(value: unknown): value is TItem;
	fullRefs?(details: unknown, items: TItem[]): string[];
};

export type RefInjectionCustomMessages<
	TCustomType extends string,
	TItem extends RefInjectionItem,
> = {
	type: TCustomType;
	create(content: string, messageItems: TItem[]): RefInjectionCustomMessage<TCustomType, TItem>;
	is(message: unknown): message is RefInjectionSessionMessage<TCustomType>;
	items(details: unknown): TItem[];
	fullRefs(message: unknown): string[];
	restoreContent<TMessage>(message: TMessage): TMessage;
	expandedContent(content: string, details: unknown): string;
};

function isRecord(value: unknown): value is { [key: string]: unknown } {
	return typeof value === "object" && value !== null;
}

function hasCustomType<TCustomType extends string>(
	value: unknown,
	customType: TCustomType,
): value is { customType: TCustomType; details?: unknown } {
	return isRecord(value) && value.customType === customType;
}

function isSessionMessage<TCustomType extends string>(
	value: unknown,
	customType: TCustomType,
): value is RefInjectionSessionMessage<TCustomType> {
	return isRecord(value)
		&& value.role === "custom"
		&& value.customType === customType
		&& typeof value.content === "string";
}

export function createRefInjectionCustomMessages<
	TCustomType extends string,
	TItemKey extends string,
	TItem extends RefInjectionItem,
>(
	config: RefInjectionCustomMessageConfig<TCustomType, TItemKey, TItem>,
): RefInjectionCustomMessages<TCustomType, TItem> {
	function items(details: unknown): TItem[] {
		if (!isRecord(details)) {
			return [];
		}

		const rawItems = details[config.itemKey];
		return Array.isArray(rawItems) ? rawItems.filter((value) => config.isItem(value)) : [];
	}

	return {
		type: config.customType,
		create(
			content: string,
			messageItems: TItem[],
		): RefInjectionCustomMessage<TCustomType, TItem> {
			const details: RefInjectionDetails<TItem> = {
				injectedContent: content,
			};
			details[config.itemKey] = messageItems;
			return {
				customType: config.customType,
				content: messageItems.map((item) => item.ref).join(", "),
				display: true,
				details,
			};
		},
		is(message: unknown): message is RefInjectionSessionMessage<TCustomType> {
			return isSessionMessage(message, config.customType);
		},
		items,
		fullRefs(message: unknown): string[] {
			const details = hasCustomType(message, config.customType) ? message.details : undefined;
			const messageItems = items(details);
			return config.fullRefs
				? config.fullRefs(details, messageItems)
				: messageItems
					.filter((item) => item.mode === "full")
					.map((item) => item.ref);
		},
		restoreContent<TMessage>(message: TMessage): TMessage {
			return isSessionMessage(message, config.customType) && message.details?.injectedContent
				? { ...message, content: message.details.injectedContent }
				: message;
		},
		expandedContent(content: string, details: unknown): string {
			return isRecord(details) && typeof details.injectedContent === "string"
				? details.injectedContent
				: content;
		},
	};
}
