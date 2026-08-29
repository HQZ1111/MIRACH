import { useCallback, useState } from "react";

export interface PastedImage {
	dataUrl: string;
	name: string;
	type: string;
}

export interface UsePasteDetectionReturn {
	pastedImages: PastedImage[];
	clearImages: () => void;
	pasteHandler: (e: ClipboardEvent) => void;
}

function readImageFromFile(file: File, type: string): Promise<PastedImage> {
	return new Promise((resolve) => {
		const reader = new FileReader();
		reader.onload = () => {
			resolve({
				dataUrl: reader.result as string,
				name: file.name || `pasted-${Date.now()}.png`,
				type,
			});
		};
		reader.readAsDataURL(file);
	});
}

export function usePasteDetection(): UsePasteDetectionReturn {
	const [pastedImages, setPastedImages] = useState<PastedImage[]>([]);

	const pasteHandler = useCallback((e: ClipboardEvent) => {
		const items = e.clipboardData?.items;
		if (!items) return;

		const imageFiles: { file: File; type: string }[] = [];

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			if (item.kind === "file" && item.type.startsWith("image/")) {
				const file = item.getAsFile();
				if (file) {
					imageFiles.push({ file, type: item.type });
				}
			}
		}

		if (imageFiles.length === 0) return;

		e.preventDefault();
		Promise.all(imageFiles.map((f) => readImageFromFile(f.file, f.type))).then((images) => {
			setPastedImages((prev) => [...prev, ...images]);
		});
	}, []);

	const clearImages = useCallback(() => {
		setPastedImages([]);
	}, []);

	return { pastedImages, clearImages, pasteHandler };
}
