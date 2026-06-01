import {
  BadRequestException,
  Inject,
  Injectable,
} from "@nestjs/common";
import {
  applyRlsContext,
  GLOBAL_TENANT_ID,
  Prisma,
  type PrismaClient,
} from "@expertos/db";
import type {
  BillingCheckoutInput,
  CheckoutSessionDto,
  PortalSessionDto,
} from "@expertos/shared";
import { RlsService } from "../auth/rls.service";
import type { AuthUser } from "../auth/auth.types";
import { StructuredLogger } from "../observability/logger.service";
import { PRISMA } from "../database/database.module";
import { PAYMENT_PROVIDER } from "./billing.tokens";
import {
  type LedgerEntry,
  type PaymentProvider,
  type SubscriptionChange,
  WebhookVerificationError,
  type WebhookRequest,
} from "./payment-provider";

/** Where the hosted-checkout redirect targets point (server-chosen, never client-supplied). */
const WEB_APP_URL = process.env.WEB_APP_URL ?? "http://localhost:3000";

/**
 * Billing orchestration (M6.2, PRD §"Paywall, Entitlements & Feature Gating").
 *
 * The single integration point between the {@link PaymentProvider} seam and our own
 * `subscriptions` + `transactions` tables (the payment **source of truth** is the provider; we mirror
 * every event so reporting survives a provider switch). Three responsibilities:
 *
 * - {@link createCheckout} / {@link createPortal} — authenticated flows: resolve the user's
 *   plan/price and existing customer under their RLS context, then hand off to the provider for a
 *   hosted session.
 * - {@link handleWebhook} — the **unauthenticated** provider callback: verify the signature, normalize
 *   the event, and idempotently sync it into `subscriptions` (upsert by provider subscription id) and
 *   the `transactions` ledger (unique `[provider, providerRef]`). It runs in a **system RLS context**
 *   (admin GUC, no acting user) because there is no request principal — the same pattern
 *   {@link AuthService} uses for find-or-create.
 *
 * This is the service that finally **populates the `subscriptions` rows `EntitlementService` reads**
 * (until now everyone resolved to Free because nothing wrote them).
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider,
    private readonly rls: RlsService,
    @Inject(PRISMA) private readonly prisma: PrismaClient,
    private readonly logger: StructuredLogger,
  ) {}

  /** Start a hosted checkout for the acting user's chosen plan + interval. */
  async createCheckout(
    user: AuthUser,
    input: BillingCheckoutInput,
  ): Promise<CheckoutSessionDto> {
    return this.rls.run(user, async (tx) => {
      const price = await tx.planPrice.findFirst({
        where: {
          interval: input.interval,
          plan: { key: input.planKey, active: true },
        },
        select: { providerPriceId: true },
      });
      if (!price?.providerPriceId) {
        throw new BadRequestException(
          `No purchasable price for plan '${input.planKey}' (${input.interval})`,
        );
      }

      // Reuse the user's existing provider customer so a returning buyer isn't duplicated.
      const existing = await tx.subscription.findFirst({
        where: { userId: user.id, providerCustomerId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { providerCustomerId: true },
      });

      const session = await this.provider.createCheckoutSession({
        priceId: price.providerPriceId,
        clientReferenceId: user.id,
        customerEmail: user.email,
        customerId: existing?.providerCustomerId ?? undefined,
        successUrl: `${WEB_APP_URL}/billing/success`,
        cancelUrl: `${WEB_APP_URL}/billing/cancel`,
      });
      return { url: session.url };
    });
  }

  /** Open the provider's customer portal for the acting user to manage/cancel their subscription. */
  async createPortal(user: AuthUser): Promise<PortalSessionDto> {
    return this.rls.run(user, async (tx) => {
      const sub = await tx.subscription.findFirst({
        where: { userId: user.id, providerCustomerId: { not: null } },
        orderBy: { createdAt: "desc" },
        select: { providerCustomerId: true },
      });
      if (!sub?.providerCustomerId) {
        throw new BadRequestException("No billing account to manage");
      }
      const session = await this.provider.openCustomerPortal({
        customerId: sub.providerCustomerId,
        returnUrl: `${WEB_APP_URL}/account`,
      });
      return { url: session.url };
    });
  }

  /**
   * Verify + apply a provider webhook. Throws `400` on an unverifiable signature; an unrecognized
   * event type is a silent no-op (we don't mirror events we don't model).
   */
  async handleWebhook(req: WebhookRequest): Promise<void> {
    let rawEvent: unknown;
    try {
      rawEvent = await this.provider.verifyWebhook(req);
    } catch (err) {
      if (err instanceof WebhookVerificationError) {
        throw new BadRequestException(err.message);
      }
      throw err;
    }

    const event = this.provider.parseEvent(rawEvent);
    if (!event) {
      return;
    }
    if (event.kind === "subscription") {
      await this.applySubscriptionChange(event);
    } else {
      await this.appendLedgerEntry(event);
    }
  }

  /**
   * Upsert the mirrored `subscriptions` row (keyed by provider subscription id, so a redelivered
   * event is idempotent). Runs in a system RLS context — the webhook has no request principal.
   */
  private async applySubscriptionChange(event: SubscriptionChange): Promise<void> {
    await this.runAsSystem(async (tx) => {
      const existing = await tx.subscription.findUnique({
        where: { providerSubId: event.providerSubscriptionId },
        select: { id: true, userId: true, tenantId: true },
      });

      // Map to a user: the checkout-stamped reference on a new subscription, else the existing row.
      const userId = event.clientReferenceId ?? existing?.userId ?? null;
      if (!userId) {
        this.logger.warn("Subscription webhook with no resolvable user; skipping", {
          providerSubscriptionId: event.providerSubscriptionId,
        });
        return;
      }

      const resolved = await this.resolvePlanPrice(tx, event.providerPriceId);
      if (!existing && !resolved) {
        // A brand-new subscription on a price we don't have mapped — can't create a valid row.
        this.logger.warn("Subscription checkout for an unmapped price; skipping", {
          providerSubscriptionId: event.providerSubscriptionId,
          providerPriceId: event.providerPriceId,
        });
        return;
      }

      // Prefer the provider-reported interval, falling back to the resolved price's interval.
      const interval = event.interval ?? resolved?.interval;

      if (existing) {
        await tx.subscription.update({
          where: { id: existing.id },
          data: {
            status: event.status,
            providerCustomerId: event.providerCustomerId,
            currentPeriodEnd: event.currentPeriodEnd,
            cancelAt: event.cancelAt,
            canceledAt: event.canceledAt,
            ...(resolved ? { planId: resolved.planId } : {}),
            ...(interval ? { interval } : {}),
          },
        });
        return;
      }

      const tenantId = await this.resolveTenantId(tx, userId);
      if (!tenantId) {
        this.logger.warn("Subscription webhook for an unknown user; skipping", { userId });
        return;
      }
      // resolved is non-null here (the !existing && !resolved branch returned above).
      await tx.subscription.create({
        data: {
          tenantId,
          userId,
          planId: resolved!.planId,
          interval: interval ?? "month",
          status: event.status,
          providerCustomerId: event.providerCustomerId,
          providerSubId: event.providerSubscriptionId,
          currentPeriodEnd: event.currentPeriodEnd,
          cancelAt: event.cancelAt,
          canceledAt: event.canceledAt,
        },
      });
    });
  }

  /**
   * Append a revenue-ledger row, idempotent on `[provider, providerRef]` (a redelivered event is a
   * no-op). Resolves the user/tenant from the customer's most recent subscription when possible.
   */
  private async appendLedgerEntry(event: LedgerEntry): Promise<void> {
    await this.runAsSystem(async (tx) => {
      const provider = this.provider.name;
      const dup = await tx.transaction.findUnique({
        where: { provider_providerRef: { provider, providerRef: event.providerRef } },
        select: { id: true },
      });
      if (dup) {
        return;
      }

      let userId: string | null = null;
      let tenantId = GLOBAL_TENANT_ID;
      if (event.providerCustomerId) {
        const sub = await tx.subscription.findFirst({
          where: { providerCustomerId: event.providerCustomerId },
          orderBy: { createdAt: "desc" },
          select: { userId: true, tenantId: true },
        });
        if (sub) {
          userId = sub.userId;
          tenantId = sub.tenantId;
        }
      }

      try {
        await tx.transaction.create({
          data: {
            tenantId,
            userId,
            amountCents: event.amountCents,
            currency: event.currency,
            type: event.type,
            status: event.status,
            provider,
            providerRef: event.providerRef,
          },
        });
      } catch (err) {
        // Lost a race with a concurrent redelivery of the same event — still idempotent.
        if (
          err instanceof Prisma.PrismaClientKnownRequestError &&
          err.code === "P2002"
        ) {
          return;
        }
        throw err;
      }
    });
  }

  /** Resolve a provider price id to our `{ planId, interval }`, or null when it isn't mapped. */
  private async resolvePlanPrice(
    tx: Prisma.TransactionClient,
    providerPriceId: string | null,
  ): Promise<{ planId: string; interval: "month" | "year" } | null> {
    if (!providerPriceId) {
      return null;
    }
    const price = await tx.planPrice.findFirst({
      where: { providerPriceId },
      select: { planId: true, interval: true },
    });
    return price ?? null;
  }

  /** The tenant a user belongs to (the row's tenant for a mirrored subscription), or null. */
  private async resolveTenantId(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<string | null> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { tenantId: true },
    });
    return user?.tenantId ?? null;
  }

  /**
   * Runs webhook DB work in a system RLS context (admin GUC, GLOBAL tenant) — there is no request
   * principal for a provider callback, and a single webhook can touch any tenant's rows. Mirrors
   * {@link AuthService.resolveUser}'s admin/system transaction.
   */
  private runAsSystem<T>(
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await applyRlsContext(tx, { tenantId: GLOBAL_TENANT_ID, isAdmin: true });
      return work(tx);
    });
  }
}
