

import { Body, Controller, Post } from '@nestjs/common';

@Controller('gps')
export class GpsController {
    constructor(private readonly gpsService:any) { }

    @Post('/telemetry')
    receiveTelemetry(@Body() body: any) {
        return this.gpsService.receiveTelemetry(body);
    }
}