import { deleteStorageObjects } from "./storage-cleanup";
import type { StorageProvider } from "./storage-provider";
import type { StructuredLogger } from "../observability/logger.service";

function makeStorage(del = jest.fn().mockResolvedValue(undefined)) {
  return { name: "mock", put: jest.fn(), delete: del } as unknown as StorageProvider;
}

function makeLogger() {
  const warn = jest.fn();
  return { logger: { warn } as unknown as StructuredLogger, warn };
}

describe("deleteStorageObjects", () => {
  it("deletes every non-empty URI and returns the success count", async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(del);
    const { logger, warn } = makeLogger();

    const deleted = await deleteStorageObjects(
      storage,
      ["memory://a", "memory://b"],
      logger,
    );

    expect(deleted).toBe(2);
    expect(del).toHaveBeenCalledTimes(2);
    expect(del).toHaveBeenCalledWith("memory://a");
    expect(del).toHaveBeenCalledWith("memory://b");
    expect(warn).not.toHaveBeenCalled();
  });

  it("skips null/empty URIs (rows that never recorded a gcs_uri)", async () => {
    const del = jest.fn().mockResolvedValue(undefined);
    const storage = makeStorage(del);
    const { logger } = makeLogger();

    const deleted = await deleteStorageObjects(
      storage,
      [null, undefined, "", "memory://only"],
      logger,
    );

    expect(deleted).toBe(1);
    expect(del).toHaveBeenCalledTimes(1);
    expect(del).toHaveBeenCalledWith("memory://only");
  });

  it("swallows a per-object failure, logs it with context, and keeps going", async () => {
    const del = jest
      .fn()
      .mockRejectedValueOnce(new Error("backend down"))
      .mockResolvedValueOnce(undefined);
    const storage = makeStorage(del);
    const { logger, warn } = makeLogger();

    const deleted = await deleteStorageObjects(storage, ["memory://x", "memory://y"], logger, {
      job: "retention",
    });

    // Second object still deleted despite the first throwing.
    expect(deleted).toBe(1);
    expect(del).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      "storage object delete failed",
      expect.objectContaining({ job: "retention", uri: "memory://x", error: "backend down" }),
    );
  });
});
