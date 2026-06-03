import {
  BadRequestException,
  Body,
  Controller,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  uploadCreateSchema,
  type UploadCreateInput,
  type UploadedFileDto,
} from "@expertos/shared";
import { CurrentUser } from "../auth/current-user.decorator";
import { Roles } from "../auth/roles.decorator";
import { RequiresEntitlement } from "../entitlements/requires-entitlement.decorator";
import type { AuthUser } from "../auth/auth.types";
import { ZodValidationPipe } from "../common/zod-validation.pipe";
import { UploadService } from "./upload.service";
import { MAX_UPLOAD_BYTES } from "./upload-content-types";

/**
 * The multipart file part, declared structurally (the same pattern as the chat controller's
 * `SseResponse`) so the route needs no `@types/multer` dependency. multer's default memory storage
 * populates `buffer`; the `limits.fileSize` guard rejects an oversize stream before the whole body
 * is buffered.
 */
interface MultipartFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

/**
 * Query-time document upload (M5.1, PRD §"Document-assisted Q&A"). `@Roles('user')` is the
 * broadest authenticated audience; tenant/user isolation is enforced by Postgres RLS inside
 * {@link UploadService} (`uploaded_files` is user-scoped). All validation/scan/store logic lives in
 * the service so it stays under the coverage gate; this controller only adapts the multipart shape.
 *
 * `@RequiresEntitlement('document_upload')` gates the route (M6.1) so the {@link EntitlementGuard}
 * checks the actor's plan BEFORE the expensive validate→scan→parse→chunk→embed pipeline runs
 * (reserve-before-work): the Free plan has the boolean feature disabled, so an unentitled upload is
 * rejected with `402` + an upgrade payload at the wall rather than burning parse/embed cost. The
 * generic per-IP throttle and 10 MiB size cap remain as defense-in-depth but do not enforce plan
 * access on their own (Security Cycle 2 Critical).
 */
@Controller("uploads")
@Roles("user")
export class UploadController {
  constructor(private readonly uploads: UploadService) {}

  @Post()
  @RequiresEntitlement("document_upload")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_UPLOAD_BYTES } }),
  )
  create(
    @CurrentUser() user: AuthUser,
    @UploadedFile() file: MultipartFile | undefined,
    @Body(new ZodValidationPipe(uploadCreateSchema)) body: UploadCreateInput,
  ): Promise<UploadedFileDto> {
    if (!file) {
      throw new BadRequestException("file is required");
    }
    return this.uploads.upload(
      user,
      {
        filename: file.originalname,
        contentType: file.mimetype,
        buffer: file.buffer,
      },
      body,
    );
  }
}
