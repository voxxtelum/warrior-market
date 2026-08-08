import { useEffect, useRef } from "react";
import { Chart, type ChartDataset } from "chart.js/auto";

Chart.defaults.font.family = "'IBM Plex Sans', system-ui, -apple-system, 'Segoe UI', sans-serif";

interface YScaleOptions {
  beginAtZero?: boolean;
  title?: { display?: boolean; text?: string };
}

interface XScaleOptions {
  type?: "linear";
  ticks?: { display?: boolean };
}

interface LineChartProps<TData = (number | null)[]> {
  labels?: string[];
  datasets: ChartDataset<"line", TData>[];
  title: string;
  height?: number;
  yScaleOptions?: YScaleOptions;
  xScaleOptions?: XScaleOptions;
  // When set, formats numeric x values (e.g. epoch ms on a linear axis) for
  // axis ticks - without it, tick rendering is untouched (category axis
  // reads straight from `labels`).
  xTickFormatter?: (value: number) => string;
  // Formats the hovered point's numeric x value for the tooltip title;
  // falls back to xTickFormatter when omitted. Kept separate so an axis can
  // show short tick labels while the tooltip shows a more precise value.
  xTooltipFormatter?: (value: number) => string;
}

export function LineChart<TData = (number | null)[]>({
  labels,
  datasets,
  title,
  height,
  yScaleOptions,
  xScaleOptions,
  xTickFormatter,
  xTooltipFormatter,
}: LineChartProps<TData>) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Chart's default generics (no type args) resolve TData to the union of
  // every chart type's data point shape, which isn't assignable from our own
  // generic TData - pin both the ref and the constructor call to the same
  // <"line", TData, string> instantiation so they agree.
  const chartRef = useRef<Chart<"line", TData, string> | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = new Chart<"line", TData, string>(canvasRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: title, color: "#e8e8ec", font: { size: 14 } },
          tooltip: (xTooltipFormatter ?? xTickFormatter)
            ? {
                callbacks: {
                  title: (items) => (xTooltipFormatter ?? xTickFormatter)!(Number(items[0]?.parsed.x)),
                },
              }
            : undefined,
        },
        scales: {
          y: yScaleOptions ?? { beginAtZero: true },
          x: {
            ...xScaleOptions,
            ticks: xTickFormatter
              ? { ...xScaleOptions?.ticks, callback: (value) => xTickFormatter(Number(value)) }
              : xScaleOptions?.ticks,
          },
        },
      },
    });
    return () => chartRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, datasets, title, yScaleOptions, xScaleOptions, xTickFormatter, xTooltipFormatter]);

  return (
    <div className="chart-container" style={height ? { height } : undefined}>
      <canvas ref={canvasRef} />
    </div>
  );
}
