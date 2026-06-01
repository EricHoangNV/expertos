import type { HTMLAttributes } from "react";
import { cx } from "./cx";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Apply the `.card-pad` (24px) inner padding. */
  pad?: boolean;
}

/** Design-system surface — renders ds.css `.card` (+ optional `.card-pad`). */
export function Card({ pad = false, className, ...rest }: CardProps) {
  return <div className={cx("card", pad && "card-pad", className)} {...rest} />;
}
