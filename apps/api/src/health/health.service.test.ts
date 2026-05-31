import { HealthService } from "./health.service";

describe("HealthService", () => {
  it("reports an ok status with the service name", () => {
    expect(new HealthService().check()).toEqual({
      status: "ok",
      service: "expertos-api",
    });
  });
});
