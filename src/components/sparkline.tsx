import { averageColorClasses } from "@/lib/grades";
import { cn } from "@/lib/utils";

/**
 * Спарклайн динамики среднего балла по четвертям.
 *
 * Чистый SVG без библиотек: линия по непустым четвертям, точки на каждом
 * значении, подпись оси — номера четвертей. Пустые четверти в линию не входят
 * (иначе провал до нуля искажал бы картину), но их место на оси сохраняется.
 */
export function QuarterSparkline({
  values,
  width = 220,
  height = 56,
  className,
}: {
  values: (number | null)[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const padX = 10;
  const padY = 8;
  const innerW = width - padX * 2;
  const innerH = height - padY * 2;

  // Ось Y привязана к шкале 1..10, чтобы наклон отражал реальные изменения.
  const minScore = 1;
  const maxScore = 10;

  const points = values.map((value, index) => {
    const x = values.length > 1 ? padX + (innerW * index) / (values.length - 1) : padX + innerW / 2;
    const y =
      value === null
        ? null
        : padY + innerH - (innerH * (value - minScore)) / (maxScore - minScore);
    return { x, y, value, index };
  });

  const filled = points.filter((p): p is { x: number; y: number; value: number; index: number } => p.y !== null);
  const line = filled.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");

  if (filled.length === 0) {
    return (
      <div
        className={cn("flex items-center justify-center text-xs text-muted-foreground", className)}
        style={{ width, height }}
      >
        нет данных для графика
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      role="img"
      aria-label={`Динамика по четвертям: ${values.map((v) => (v === null ? "—" : v)).join(", ")}`}
    >
      {/* Опорные линии для 5 и 8 — «удовлетворительно» и «хорошо» */}
      {[5, 8].map((mark) => {
        const y = padY + innerH - (innerH * (mark - minScore)) / (maxScore - minScore);
        return (
          <line
            key={mark}
            x1={padX}
            y1={y}
            x2={width - padX}
            y2={y}
            stroke="hsl(var(--rule))"
            strokeWidth={1}
            strokeDasharray="3 3"
          />
        );
      })}

      {filled.length > 1 && (
        <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      )}

      {filled.map((p) => (
        <circle key={p.index} cx={p.x} cy={p.y} r={3} fill="hsl(var(--primary))" />
      ))}
    </svg>
  );
}

/** Компактная строка «четверти → цифры» под спарклайном. */
export function QuarterLegend({ values }: { values: (number | null)[] }) {
  return (
    <div className="flex justify-between px-2 text-[11px] text-muted-foreground">
      {values.map((value, index) => (
        <span key={index} className="flex flex-col items-center gap-0.5">
          <span>{index + 1}</span>
          <span className={cn("font-semibold tabular-nums", averageColorClasses(value))}>
            {value === null ? "—" : value.toFixed(2)}
          </span>
        </span>
      ))}
    </div>
  );
}
