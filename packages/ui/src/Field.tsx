import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from "react";
import { cx } from "./cx";

export interface FieldProps extends HTMLAttributes<HTMLDivElement> {
  /** Field label text. */
  label?: ReactNode;
  /** `htmlFor` wiring the label to its control. */
  htmlFor?: string;
}

/** Design-system form field — renders ds.css `.field` (label + control). */
export function Field({
  label,
  htmlFor,
  className,
  children,
  ...rest
}: FieldProps) {
  return (
    <div className={cx("field", className)} {...rest}>
      {label != null && <label htmlFor={htmlFor}>{label}</label>}
      {children}
    </div>
  );
}

/** Design-system text input — renders ds.css `.input`. */
export function Input({
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx("input", className)} {...rest} />;
}

/** Design-system select — renders ds.css `.select`. */
export function Select({
  className,
  ...rest
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cx("select", className)} {...rest} />;
}

/** Design-system textarea — renders ds.css `.textarea`. */
export function Textarea({
  className,
  ...rest
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx("textarea", className)} {...rest} />;
}
