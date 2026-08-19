import { useLayoutEffect, useRef, useState } from 'react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode;
  label: string;
}

// Locks the button's rendered width on mount so the icon-btn hover
// animation (label collapses, icon re-centers) can't change the button's
// footprint - without this, a shared CSS min-width would either clip long
// labels or leave short ones looking over-padded.
export function IconButton({ icon, label, className = '', ...rest }: IconButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [width, setWidth] = useState<number>();

  useLayoutEffect(() => {
    if (ref.current) setWidth(ref.current.offsetWidth);
  }, [label]);

  return (
    <button
      ref={ref}
      type="button"
      className={`icon-btn ${className}`.trim()}
      style={width ? { width } : undefined}
      {...rest}
    >
      {icon}
      <span className="icon-btn-label">{label}</span>
    </button>
  );
}
