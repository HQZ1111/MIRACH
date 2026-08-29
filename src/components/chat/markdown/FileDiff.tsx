/**
 * FileDiff - 文件 diff 面板
 *
 * + 行绿色，- 行红色，上下文行无着色。
 */

export function FileDiff({
  filename,
  content,
}: {
  filename: string;
  content: string;
}) {
  const lines = content.split("\n");

  return (
    <div className="my-2 overflow-hidden rounded-lg border border-black/10">
      <div className="bg-muted/50 px-3 py-1 text-[12px] font-medium text-muted-foreground">
        {filename}
      </div>
      <pre className="overflow-x-auto p-3 text-[13px] font-mono leading-relaxed">
        {lines.map((line, i) => (
          <div
            key={i}
            className={
              line.startsWith("+") && !line.startsWith("+++")
                ? "bg-green-50 text-green-700"
                : line.startsWith("-") && !line.startsWith("---")
                  ? "bg-red-50 text-red-700"
                  : ""
            }
          >
            {line || " "}
          </div>
        ))}
      </pre>
    </div>
  );
}
