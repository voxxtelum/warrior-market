import { useEffect, useRef } from "react";
import { Chart, type ChartDataset } from "chart.js/auto";

interface YScaleOptions {
  beginAtZero?: boolean;
  title?: { display?: boolean; text?: string };
}

interface LineChartProps {
  labels: string[];
  datasets: ChartDataset<"line", (number | null)[]>[];
  title: string;
  height?: number;
  yScaleOptions?: YScaleOptions;
}

export function LineChart({ labels, datasets, title, height, yScaleOptions }: LineChartProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    chartRef.current = new Chart(canvasRef.current, {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { position: "bottom" },
          title: { display: true, text: title, color: "#e8e8ec", font: { size: 14 } },
        },
        scales: { y: yScaleOptions ?? { beginAtZero: true } },
      },
    });
    return () => chartRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [labels, datasets, title, yScaleOptions]);

  return (
    <div className="chart-container" style={height ? { height } : undefined}>
      <canvas ref={canvasRef} />
    </div>
  );
}
