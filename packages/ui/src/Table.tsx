import type { TableHTMLAttributes } from "react";
import { cx } from "./cx";

export type TableProps = TableHTMLAttributes<HTMLTableElement>;

/**
 * Design-system table — renders ds.css `.table` (mono uppercase headers,
 * hairline rows, hover tint). Compose native `<thead>/<tbody>/<tr>/<th>/<td>`.
 */
export function Table({ className, ...rest }: TableProps) {
  return <table className={cx("table", className)} {...rest} />;
}
