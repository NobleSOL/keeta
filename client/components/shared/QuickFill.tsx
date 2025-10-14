import { Button } from "@/components/ui/button";

export default function QuickFill({
  balance,
  onSelect,
  percents = [10, 25, 50, 75, 100],
}: {
  balance?: number;
  onSelect: (v: string) => void;
  percents?: number[];
}) {
  if (balance == null) return null;
  const handle = (p: number) => {
    const v = (balance * (p / 100)).toString();
    onSelect(v);
  };
  return (
    <div className="flex items-center gap-1 text-[11px]">
      {percents.map((p) => (
        <Button
          key={p}
          type="button"
          size="sm"
          variant="secondary"
          className="h-6 px-2"
          onClick={() => handle(p)}
        >
          {p}%
        </Button>
      ))}
    </div>
  );
}
