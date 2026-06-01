import { Body, Controller, Post, Req } from "@nestjs/common";
import {
  billingCheckoutSchema,
  type BillingCheckoutInput,
  type CheckoutSessionDto,
  type PortalSessionDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Public } from "../auth/public.decorator";
import { Roles } from "../auth/roles.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { BillingService } from "./billing.service";

/**
 * The raw request fields the webhook needs, declared structurally (the chat `SseResponse` pattern) so
 * the route depends on no Express types. `rawBody` is populated by `NestFactory.create(.., { rawBody:
 * true })` — signature verification must run over the **unparsed** bytes, not the JSON-reparsed body.
 */
interface WebhookHttpRequest {
  rawBody?: Buffer;
  headers: Record<string, string | undefined>;
}

/**
 * Billing endpoints (M6.2, PRD §"Paywall flow"). Checkout/portal are authenticated user actions;
 * the webhook is the provider's unauthenticated callback (`@Public()`, verified by signature instead
 * of a Firebase token). All branchy logic lives in {@link BillingService} so it stays under the
 * coverage gate; this controller only adapts the HTTP shape.
 */
@Controller("billing")
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post("checkout")
  @Roles("user")
  createCheckout(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(billingCheckoutSchema)) body: BillingCheckoutInput,
  ): Promise<CheckoutSessionDto> {
    return this.billing.createCheckout(user, body);
  }

  @Post("portal")
  @Roles("user")
  createPortal(@CurrentUser() user: AuthUser): Promise<PortalSessionDto> {
    return this.billing.createPortal(user);
  }

  @Public()
  @Post("webhook")
  async webhook(@Req() req: WebhookHttpRequest): Promise<{ received: boolean }> {
    await this.billing.handleWebhook({
      payload: req.rawBody ?? Buffer.alloc(0),
      signature: req.headers["stripe-signature"],
    });
    return { received: true };
  }
}
