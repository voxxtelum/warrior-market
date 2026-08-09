export function SidePill({ side }: { side: 'buy' | 'sell' | 'liquidation' }) {
  return (
    <span className={`side-pill ${side}`}>
      {side === 'liquidation' ? 'liq' : side}
    </span>
  );
}
