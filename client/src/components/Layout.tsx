import type { ReactNode } from "react";
import { MainNav } from "./MainNav";
import { NotificationBanner } from "./NotificationBanner";
import { GlobalFooter } from "./GlobalFooter";

interface LayoutProps {
  title: string;
  subtitle: ReactNode;
  icon?: ReactNode;
  children: ReactNode;
}

export function Layout({ title, subtitle, icon, children }: LayoutProps) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1 className={icon ? "page-title" : undefined}>
            {icon}
            {title}
          </h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="header-actions">
          <MainNav />
        </div>
      </div>

      <NotificationBanner />

      {children}

      <GlobalFooter />
    </>
  );
}
