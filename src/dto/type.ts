export interface GpsBody {
  imei: string;
  latitude: number;
  longitude: number;
  speed: number;
  timestamp: string;
  din1?: number;
  din2?: number;
  dout1?: number;
  ain1?: number;
  ignition?: number;
  externalVoltage?: number;
  batteryVoltage?: number;
}