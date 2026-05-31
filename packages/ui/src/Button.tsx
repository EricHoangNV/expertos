import type { ButtonHTMLAttributes } from "react";
import { cx } from "./cx";

export type ButtonVariant = "primary" | "dark" | "ghost" | "subtle";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "btn-primary",
  dark: "btn-dark",
  ghost: "btn-ghost",
  subtle: "btn-subtle",
};

const SIZE_CLASS: Record<ButtonSize, string | false> = {
  sm: "btn-sm",
  md: false,
  lg: "btn-lg",
};

/** Design-system button — renders ds.css `.btn` classes. */
export function Button({
  variant = "primary",
  size = "md",
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cx("btn", VARIANT_CLASS[variant], SIZE_CLASS[size], className)}
      {...rest}
    />
  );
}
