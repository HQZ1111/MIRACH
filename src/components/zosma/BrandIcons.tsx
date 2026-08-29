/**
 * BrandIcons — Clean SVG logos for AI providers
 *
 * Minimal, recognizable brand marks. All 24×24 viewBox, scale to any size.
 */

export function ClaudeIcon({ className }: { className?: string }) {
	return (
		<svg
			role="img"
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-label="Claude"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Stylized mountain/C — Anthropic brand feel */}
			<path
				d="M12 2L4 22h4l1.5-4h5l1.5 4h4L12 2zm-1.5 12l1.5-4 1.5 4h-3z"
				fill="currentColor"
				opacity="0.9"
			/>
		</svg>
	);
}

export function GitHubIcon({ className }: { className?: string }) {
	return (
		<svg
			role="img"
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-label="GitHub"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Simplified GitHub Octocat silhouette */}
			<path
				d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.167 6.839 9.49.5.09.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844a9.59 9.59 0 012.501.337c1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.577.688.48C19.138 20.163 22 16.418 22 12c0-5.523-4.477-10-10-10z"
				fill="currentColor"
				opacity="0.9"
			/>
		</svg>
	);
}

export function OpenAIIcon({ className }: { className?: string }) {
	return (
		<svg
			role="img"
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-label="OpenAI"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Stylized six-point sparkle / flower — OpenAI brand feel */}
			<path
				d="M12 2l1.5 4.5L18 4.5l-1.5 4.5 4.5 1.5-4.5 1.5 1.5 4.5-4.5-1.5L12 18l-1.5-4.5L6 15.5l1.5-4.5L3 9.5l4.5-1.5L6 3.5l4.5 1.5L12 2z"
				fill="currentColor"
				opacity="0.9"
			/>
		</svg>
	);
}

export function GeminiIcon({ className }: { className?: string }) {
	return (
		<svg
			role="img"
			viewBox="0 0 24 24"
			fill="none"
			className={className}
			aria-label="Gemini"
			xmlns="http://www.w3.org/2000/svg"
		>
			{/* Four-point spark — Gemini brand feel */}
			<path
				d="M12 2c.4 5.1 4.9 9.6 10 10-5.1.4-9.6 4.9-10 10-.4-5.1-4.9-9.6-10-10 5.1-.4 9.6-4.9 10-10z"
				fill="currentColor"
				opacity="0.9"
			/>
		</svg>
	);
}
