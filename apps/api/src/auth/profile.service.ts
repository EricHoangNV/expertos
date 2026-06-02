import { Injectable } from "@nestjs/common";
import type { LanguageValue, UserProfileDto } from "@expertos/shared";
import { RlsService } from "./rls.service";
import type { AuthUser } from "./auth.types";

/**
 * Self-service profile updates for the acting user (M13.1). Writes run under the user's own RLS
 * context ({@link RlsService}), so the update is structurally scoped to their tenant — the `where`
 * pins the user's own id, and RLS rejects any attempt to reach across the tenant boundary.
 */
@Injectable()
export class ProfileService {
  constructor(private readonly rls: RlsService) {}

  /** Persist the user's preferred locale onto their row and return the refreshed profile. */
  updateLocale(user: AuthUser, locale: LanguageValue): Promise<UserProfileDto> {
    return this.rls.run(user, async (tx) => {
      const updated = await tx.user.update({
        where: { id: user.id },
        data: { locale },
        select: { id: true, email: true, displayName: true, role: true, locale: true },
      });
      return {
        id: updated.id,
        email: updated.email,
        displayName: updated.displayName,
        role: updated.role,
        locale: updated.locale,
      };
    });
  }
}
