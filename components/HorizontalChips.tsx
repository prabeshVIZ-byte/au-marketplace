"use client";

type Chip = { label: string; value: string };

export default function HorizontalChips({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Chip[];
}) {
  return (
    <div className="mb-4">
      <div className="text-sm text-white/70 mb-2">{label}</div>

      <div className="flex gap-2 overflow-x-auto pb-2 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {options.map((opt) => {
          const active = value === opt.value;
          return (
            <button
              key={opt.value}
              onClick={() => onChange(opt.value)}
              className={[
                "shrink-0 rounded-full px-4 py-2 text-sm border transition",
                active
                  ? "bg-emerald-500/20 border-emerald-400/40 text-emerald-200"
                  : "bg-white/5 border-white/10 text-white/80 hover:bg-white/10",
              ].join(" ")}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}