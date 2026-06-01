import { Body, Controller, Post, Req } from "@nestjs/common";
import {
  bookingReconcileSchema,
  type BookingReconcileInput,
  type BookingReconcileResultDto,
} from "@expertos/shared";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BookingService } from "./booking.service";

/**
 * The raw request fields the booking webhook needs, declared structurally (the billing
 * `WebhookHttpRequest` / chat `SseResponse` pattern) so the route depends on no Express types.
 * `rawBody` is populated by `NestFactory.create(.., { rawBody: true })` — signature verification must
 * run over the **unparsed** bytes, not the JSON-reparsed body.
 */
interface BookingWebhookHttpRequest {
  rawBody?: Buffer;
  headers: Record<string, string | undefined>;
}

/**
 * Booking endpoints (M7.3, PRD §"Consultation funnel"; resolves Open Decision #10). The webhook is
 * TidyCal's unauthenticated callback (`@Public()`, verified by signature instead of a Firebase token);
 * reconcile is an admin-only missed-event recovery action. All branchy logic lives in
 * {@link BookingService} so it stays under the coverage gate; this controller only adapts the HTTP shape.
 */
@Controller("consultation-bookings")
export class ConsultationBookingsController {
  constructor(private readonly booking: BookingService) {}

  @Public()
  @Post("webhook")
  async webhook(@Req() req: BookingWebhookHttpRequest): Promise<{ received: boolean }> {
    await this.booking.handleWebhook({
      payload: req.rawBody ?? Buffer.alloc(0),
      signature: req.headers["tidycal-signature"],
    });
    return { received: true };
  }

  @Post("reconcile")
  @Roles("admin")
  reconcile(
    @Body(new ZodValidationPipe(bookingReconcileSchema)) body: BookingReconcileInput,
  ): Promise<BookingReconcileResultDto> {
    return this.booking.reconcile(body);
  }
}
