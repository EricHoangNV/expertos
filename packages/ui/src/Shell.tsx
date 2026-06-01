import type { HTMLAttributes, ReactNode } from "react";
import { cx } from "./cx";

export interface ShellProps extends HTMLAttributes<HTMLDivElement> {
  /** Sidebar content rendered into the `.side` (ink-900) rail. */
  sidebar?: ReactNode;
}

/**
 * Design-system app frame — renders ds.css `.shell` (248px ink-900 sidebar +
 * `.main` column). Shared by the admin and expert portals (Phase 1).
 */
export function Shell({ sidebar, className, children, ...rest }: ShellProps) {
  return (
    <div className={cx("shell", className)} {...rest}>
      {sidebar != null && <aside className="side">{sidebar}</aside>}
      <div className="main">{children}</div>
    </div>
  );
}

/** Design-system sticky top bar — renders ds.css `.topbar`. */
export function Topbar({
  className,
  ...rest
}: HTMLAttributes<HTMLElement>) {
  return <header className={cx("topbar", className)} {...rest} />;
}

export interface ContentProps extends HTMLAttributes<HTMLDivElement> {
  /** Constrain to the centered 1080px `.content-narrow` column. */
  narrow?: boolean;
}

/** Design-system content region — renders ds.css `.content`. */
export function Content({ narrow = false, className, children, ...rest }: ContentProps) {
  return (
    <div className={cx("content", className)} {...rest}>
      {narrow ? <div className="content-narrow">{children}</div> : children}
    </div>
  );
}
