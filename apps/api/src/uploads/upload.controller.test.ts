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
});
