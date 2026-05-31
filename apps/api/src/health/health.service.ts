import { Injectable } from "@nestjs/common";

export interface HealthStatus {
  status: "ok";
  service: string;
}

@Injectable()
export class HealthService {
  check(): HealthStatus {
    return { status: "ok", service: "expertos-api" };
  }
}
