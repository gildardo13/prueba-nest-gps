import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { GpsController } from './tcp-server.controller';

@Module({
  imports: [],
  controllers: [AppController,
    GpsController
  ],
  providers: [AppService],
})
export class AppModule {}
