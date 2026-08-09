import { useEffect, useState } from "react";

const QUERY = "(max-width: 768px)";

export function useIsMobile(): boolean {
  const [isMobile, setIsMobile] = useState(
    () => typeof window !== "undefined" && window.matchMedia(QUERY).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    // Some embedded/automated viewports resize without firing the
    // MediaQueryList "change" event, so also recheck on window resize.
    const handler = () => setIsMobile(mql.matches);
    mql.addEventListener("change", handler);
    window.addEventListener("resize", handler);
    return () => {
      mql.removeEventListener("change", handler);
      window.removeEventListener("resize", handler);
    };
  }, []);

  return isMobile;
}
