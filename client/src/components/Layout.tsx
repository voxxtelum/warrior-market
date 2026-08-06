import type { ReactNode } from "react";
import { MainNav } from "./MainNav";
import { AdminMenu } from "./AdminMenu";

interface LayoutProps {
  title: string;
  subtitle: ReactNode;
  children: ReactNode;
}

export function Layout({ title, subtitle, children }: LayoutProps) {
  return (
    <>
      <div className="page-header">
        <div>
          <h1>{title}</h1>
          <p className="subtitle">{subtitle}</p>
        </div>
        <div className="header-actions">
          <MainNav />
          <AdminMenu />
        </div>
      </div>

      {children}
    </>
  );
}
