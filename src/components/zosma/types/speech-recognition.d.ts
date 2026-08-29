/**
 * Web Speech API type declarations for TypeScript.
 * The DOM lib in ES2022 doesn't include the Speech Recognition API.
 */

interface SpeechRecognition extends EventTarget {
	lang: string;
	interimResults: boolean;
	continuous: boolean;
	start(): void;
	stop(): void;
	abort(): void;
	onresult: ((event: SpeechRecognitionEvent) => void) | null;
	onend: (() => void) | null;
	onerror: ((event: { error: string }) => void) | null;
}

interface SpeechRecognitionEvent {
	results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
	length: number;
	[index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
	length: number;
	[index: number]: SpeechRecognitionResultItem;
	isFinal?: boolean;
}

interface SpeechRecognitionResultItem {
	transcript: string;
	confidence: number;
}

interface Window {
	SpeechRecognition?: new () => SpeechRecognition;
	webkitSpeechRecognition?: new () => SpeechRecognition;
}
