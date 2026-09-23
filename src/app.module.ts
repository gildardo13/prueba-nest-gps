import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GpsController } from './tcp-server.controller';
import { GpsService } from './tcp-server.service';

@Module({
  imports: [],
  controllers: [AppController,
    GpsController
  ],
  providers: [AppService, GpsService],
})
export class AppModule {}
