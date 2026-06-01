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
});
