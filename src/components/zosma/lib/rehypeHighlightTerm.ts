import type { Element, Properties, Root, Text } from "hast";
import { visit } from "unist-util-visit";

export interface HighlightTermOptions {
	/** The search term to wrap. Case-insensitive. Empty → no-op. */
	term: string;
	/**
	 * Index (0-based, within THIS message's rendered text) of the occurrence to
	 * mark as the active match — gets `data-find-active="true"` for distinct
	 * styling + scroll targeting. Omit to highlight all occurrences equally.
	 */
	activeIndex?: number;
}

/**
 * rehype plugin that wraps every case-insensitive occurrence of `term` in a
 * `<mark class="find-highlight">` element. The active occurrence (per
 * `activeIndex`) additionally gets `data-find-active="true"`.
 *
 * Works on the RENDERED hast tree (after markdown → HTML), so highlighting
 * survives formatting (bold, links, …) without mutating React-owned DOM nodes.
 * Code/pre blocks are skipped so we never break syntax-highlighted regions.
 */
export function rehypeHighlightTerm(options: HighlightTermOptions) {
	const term = options.term?.trim() ?? "";
	const activeIndex = options.activeIndex;

	return (tree: Root) => {
		if (!term) return;
		const needle = term.toLowerCase();
		// Running occurrence counter across the whole message tree, so the active
		// index lines up with top-to-bottom reading order.
		let counter = 0;

		visit(tree, "text", (node: Text, index, parent) => {
			if (index == null || !parent) return;
			const parentEl = parent as Element;
			if (parentEl.type === "element") {
				const tag = parentEl.tagName;
				if (tag === "code" || tag === "pre" || tag === "mark") return;
			}

			const value = node.value;
			const lower = value.toLowerCase();
			if (!lower.includes(needle)) return;

			const out: Array<Text | Element> = [];
			let from = 0;
			let at = lower.indexOf(needle, from);
			while (at !== -1) {
				if (at > from) {
					out.push({ type: "text", value: value.slice(from, at) });
				}
				const isActive = activeIndex != null && counter === activeIndex;
				const properties: Properties = {
					className: isActive ? ["find-highlight", "find-highlight-active"] : ["find-highlight"],
					"data-find": "",
				};
				if (isActive) properties["data-find-active"] = "true";
				out.push({
					type: "element",
					tagName: "mark",
					properties,
					children: [{ type: "text", value: value.slice(at, at + needle.length) }],
				});
				counter++;
				from = at + needle.length;
				at = lower.indexOf(needle, from);
			}
			if (from < value.length) {
				out.push({ type: "text", value: value.slice(from) });
			}

			// Replace this text node with the split sequence.
			(parentEl.children as Array<Text | Element>).splice(index, 1, ...out);
			// Skip the nodes we just inserted.
			return index + out.length;
		});
	};
}
