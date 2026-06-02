import type {
  HTMLAttributes,
  InputHTMLAttributes,
  ReactNode,
  Ref,
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

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /**
   * Ref to the underlying `<textarea>`. A custom prop (not React's reserved
   * `ref`) so `Textarea` stays a plain callable function — callers that need the
   * element (e.g. ChatInputBar's auto-resize) pass it without forwardRef.
   */
  inputRef?: Ref<HTMLTextAreaElement>;
}

/** Design-system textarea — renders ds.css `.textarea`. */
export function Textarea({ className, inputRef, ...rest }: TextareaProps) {
  return <textarea ref={inputRef} className={cx("textarea", className)} {...rest} />;
}
