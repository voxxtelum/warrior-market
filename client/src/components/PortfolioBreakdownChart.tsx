import { useEffect, useRef } from 'react';
import { Chart } from 'chart.js/auto';
import { paletteColor } from '../chartColors';
import { fmtCoin } from '../format';
import { useIsMobile } from '../hooks/useIsMobile';

export interface PortfolioBreakdownChartProps {
  holdings: { playerName: string; server: string; marketValue: number | null }[];
  height?: number;
}

export function PortfolioBreakdownChart({
  holdings,
  height = 260,
}: PortfolioBreakdownChartProps) {
  const isMobile = useIsMobile();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart<'doughnut', number[], string> | null>(null);

  const filtered = holdings.filter(
    (h): h is typeof h & { marketValue: number } =>
      h.marketValue !== null && h.marketValue > 0,
  );
  const total = filtered.reduce((sum, h) => sum + h.marketValue, 0);

  useEffect(() => {
    if (!canvasRef.current || filtered.length === 0) return;
    chartRef.current = new Chart<'doughnut', number[], string>(
      canvasRef.current,
      {
        type: 'doughnut',
        data: {
          labels: filtered.map((h) => h.playerName),
          datasets: [
            {
              data: filtered.map((h) => h.marketValue),
              backgroundColor: filtered.map((_, i) => paletteColor(i)),
              borderWidth: 0,
            },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { position: isMobile ? 'bottom' : 'right' },
            tooltip: {
              callbacks: {
                label: (item) => {
                  const value = item.parsed as number;
                  const pct = total > 0 ? (value / total) * 100 : 0;
                  return `${item.label}: ${fmtCoin(value)} (${pct.toFixed(1)}%)`;
                },
              },
            },
          },
        },
      },
    );
    return () => chartRef.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holdings, isMobile]);

  if (filtered.length === 0) {
    return <p className="no-data">No holdings to break down yet.</p>;
  }

  return (
    <div className="chart-container" style={{ height }}>
      <canvas ref={canvasRef} />
    </div>
  );
}
