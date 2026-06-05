import { BadRequestException } from "@nestjs/common";
import { UploadController } from "./upload.controller";
import type { UploadService } from "./upload.service";
import type { AuthUser } from "../auth/auth.types";
import type { UploadCreateInput } from "@expertos/shared";
import { REQUIRES_ENTITLEMENT_KEY } from "../entitlements/requires-entitlement.decorator";

const USER = { id: "u1" } as AuthUser;
const BODY: UploadCreateInput = { mode: "temporary" };

describe("UploadController", () => {
  it("gates POST /uploads behind the document_upload entitlement (reserve-before-work)", () => {
    // The EntitlementGuard reads this metadata and 402s before the validate→scan→parse→chunk→embed
    // pipeline runs, so an unentitled (e.g. Free-plan) upload never burns parse/embed cost.
    // Security Cycle 2 Critical: document-upload entitlement must be enforced before work.
    const feature = Reflect.getMetadata(
      REQUIRES_ENTITLEMENT_KEY,
      UploadController.prototype.create,
    );
    expect(feature).toBe("document_upload");
  });

  it("rejects a request with no file part before touching the service", () => {
    const upload = jest.fn();
    const controller = new UploadController({ upload } as unknown as UploadService);

    expect(() => controller.create(USER, undefined, BODY)).toThrow(
      BadRequestException,
    );
    expect(upload).not.toHaveBeenCalled();
  });

  it("adapts the multipart shape and delegates to the service", async () => {
    const upload = jest.fn().mockResolvedValue({ id: "f1" });
    const controller = new UploadController({ upload } as unknown as UploadService);
    const file = {
      originalname: "report.pdf",
      mimetype: "application/pdf",
      buffer: Buffer.from("data"),
    };

    await controller.create(USER, file, BODY);

    expect(upload).toHaveBeenCalledWith(
      USER,
      { filename: "report.pdf", contentType: "application/pdf", buffer: file.buffer },
      BODY,
    );
  });

  it("does NOT entitlement-gate GET/DELETE (a downgraded user must see + delete their data)", () => {
    // M18 / PRD §"M18": list + delete carry @Roles("user") only — gating read/delete behind the
    // upload entitlement would trap a downgraded or over-quota user's existing documents. Only POST
    // keeps the document_upload guard (asserted above).
    expect(
      Reflect.getMetadata(REQUIRES_ENTITLEMENT_KEY, UploadController.prototype.list),
    ).toBeUndefined();
    expect(
      Reflect.getMetadata(REQUIRES_ENTITLEMENT_KEY, UploadController.prototype.remove),
    ).toBeUndefined();
  });

  it("delegates GET /uploads to the service with the parsed scope query", async () => {
    const list = jest.fn().mockResolvedValue([{ id: "f1" }]);
    const controller = new UploadController({ list } as unknown as UploadService);

    await controller.list(USER, { scope: "persistent" });

    expect(list).toHaveBeenCalledWith(USER, { scope: "persistent" });
  });

  it("delegates DELETE /uploads/:id to the service", async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const controller = new UploadController({ remove } as unknown as UploadService);

    await controller.remove(USER, "ff000000-0000-0000-0000-000000000001");

    expect(remove).toHaveBeenCalledWith(USER, "ff000000-0000-0000-0000-000000000001");
  });
});
