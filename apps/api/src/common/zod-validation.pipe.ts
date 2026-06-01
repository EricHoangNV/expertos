import { BadRequestException, type PipeTransform } from "@nestjs/common";

/** A validation issue, structurally compatible with Zod's `ZodIssue`. */
interface ParseIssue {
  path: (string | number)[];
  message: string;
}

/**
 * The slice of a Zod schema this pipe needs. Typed structurally so `apps/api` does not take a
 * direct dependency on `zod` — schemas are authored in `@expertos/shared` and passed in here.
 */
interface ParseableSchema<T> {
  safeParse(
    value: unknown,
  ):
    | { success: true; data: T }
    | { success: false; error: { issues: ParseIssue[] } };
}

/**
 * Validates a request body / query against a Zod schema and returns the parsed (and
 * transformed — e.g. NFC-normalized, defaulted) value, so controllers and services only
 * ever see well-formed input. A schema failure becomes a 400 with the field-level issues
 * (no stack / internals leaked — the {@link AllExceptionsFilter} logs it at WARNING, not
 * ERROR, since a bad request is not a bug).
 */
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ParseableSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(
        result.error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      );
    }
    return result.data;
  }
}
