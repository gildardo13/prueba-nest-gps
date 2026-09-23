

import { Body, Controller, Post } from '@nestjs/common';
import { GpsService } from './tcp-server.service';

@Controller('gps')
export class GpsController {
    constructor(private readonly gpsService:GpsService) { }

    @Post('/telemetry')
    receiveTelemetry(@Body() body: any) {
        return this.gpsService.receiveTelemetry(body);
    }
}