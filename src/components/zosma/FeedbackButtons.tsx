import { trackEvent } from "@/components/zosma/lib/telemetry";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { useCallback, useRef, useState } from "react";

type Rating = "up" | "down" | null;

export function FeedbackButtons() {
	const [rating, setRating] = useState<Rating>(null);
	const [showFeedback, setShowFeedback] = useState(false);
	const [feedbackText, setFeedbackText] = useState("");
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	const handleUp = useCallback(() => {
		if (rating === "up") {
			setRating(null);
		} else {
			setRating("up");
			setShowFeedback(false);
			setFeedbackText("");
			trackEvent("feedback", { rating: "up" });
		}
	}, [rating]);

	const handleDown = useCallback(() => {
		if (rating === "down") {
			setRating(null);
			setShowFeedback(false);
			setFeedbackText("");
		} else {
			setRating("down");
			setShowFeedback(true);
			// Focus the textarea after render
			setTimeout(() => textareaRef.current?.focus(), 0);
		}
	}, [rating]);

	const handleSubmit = useCallback(() => {
		const props: Record<string, string | number> = { rating: "down" };
		if (feedbackText.trim()) {
			props.message = feedbackText.trim();
		}
		trackEvent("feedback", props);
		setShowFeedback(false);
	}, [feedbackText]);

	const handleKeyDown = useCallback(
		(e: React.KeyboardEvent) => {
			if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				handleSubmit();
			}
		},
		[handleSubmit],
	);

	return (
		<div className="flex items-center gap-1 mt-1">
			<button
				type="button"
				title="Good response"
				onClick={handleUp}
				className={`p-0.5 rounded transition-colors ${
					rating === "up"
						? "text-primary hover:text-primary/80"
						: "text-muted-foreground/40 hover:text-muted-foreground/70"
				}`}
			>
				<ThumbsUp className="w-3.5 h-3.5" />
			</button>
			<button
				type="button"
				title="Bad response"
				onClick={handleDown}
				className={`p-0.5 rounded transition-colors ${
					rating === "down"
						? "text-destructive hover:text-destructive/80"
						: "text-muted-foreground/40 hover:text-muted-foreground/70"
				}`}
			>
				<ThumbsDown className="w-3.5 h-3.5" />
			</button>

			{showFeedback && (
				<div className="flex items-center gap-1.5 ml-1 flex-1">
					<textarea
						ref={textareaRef}
						placeholder="What went wrong? (optional)"
						value={feedbackText}
						onChange={(e) => setFeedbackText(e.target.value)}
						onKeyDown={handleKeyDown}
						rows={1}
						className="flex-1 text-xs px-2 py-1 bg-background border border-border rounded resize-none focus:outline-none focus:ring-1 focus:ring-ring min-w-[120px]"
					/>
					<button
						type="button"
						onClick={handleSubmit}
						className="shrink-0 px-2 py-1 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/80 transition-colors"
					>
						Submit
					</button>
				</div>
			)}
		</div>
	);
}
