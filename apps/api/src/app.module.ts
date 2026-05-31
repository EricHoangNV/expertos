import { Module } from "@nestjs/common";
import { AuthModule } from "./auth/auth.module";
import { DatabaseModule } from "./database/database.module";
import { HealthController } from "./health/health.controller";
import { HealthService } from "./health/health.service";

@Module({
  imports: [DatabaseModule, AuthModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
