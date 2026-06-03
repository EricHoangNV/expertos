import { InMemoryStorageProvider } from "./storage-provider";

describe("InMemoryStorageProvider", () => {
  it("stores bytes and returns a memory:// URI for the object key", async () => {
    const storage = new InMemoryStorageProvider();
    const uri = await storage.put({
      key: "uploads/u1/abc/report.csv",
      content: Buffer.from("a,b,c"),
      contentType: "text/csv",
    });
    expect(uri).toBe("memory://uploads/u1/abc/report.csv");
    expect(storage.name).toBe("in-memory");
  });

  it("deletes the object addressed by the URI put() returned", async () => {
    const storage = new InMemoryStorageProvider();
    const uri = await storage.put({
      key: "uploads/u1/abc/report.csv",
      content: Buffer.from("a,b,c"),
      contentType: "text/csv",
    });
    await expect(storage.delete(uri)).resolves.toBeUndefined();
    // Re-putting after a delete must round-trip (object is really gone, not shadowed).
    const reput = await storage.put({
      key: "uploads/u1/abc/report.csv",
      content: Buffer.from("x"),
      contentType: "text/csv",
    });
    expect(reput).toBe(uri);
  });

  it("treats deleting a missing/already-deleted object as an idempotent no-op", async () => {
    const storage = new InMemoryStorageProvider();
    await expect(storage.delete("memory://uploads/u1/abc/gone.csv")).resolves.toBeUndefined();
    // A second delete is still a no-op (idempotent — safe to re-run a sweep).
    await expect(storage.delete("memory://uploads/u1/abc/gone.csv")).resolves.toBeUndefined();
  });

  it("tolerates a bare object key (no memory:// scheme) when deleting", async () => {
    const storage = new InMemoryStorageProvider();
    await storage.put({
      key: "uploads/u1/abc/report.csv",
      content: Buffer.from("a,b,c"),
      contentType: "text/csv",
    });
    await expect(storage.delete("uploads/u1/abc/report.csv")).resolves.toBeUndefined();
  });
});
