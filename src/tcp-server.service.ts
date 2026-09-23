import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import * as net from 'net';
import * as fs from 'fs';
import * as path from 'path';
import { parseAvlData } from './helpers/teltonika-parser';
import { GpsBody } from './dto/type';

@Injectable()
export class GpsService implements OnApplicationBootstrap, OnModuleDestroy {
    private readonly logger = new Logger(GpsService.name);
    private server: net.Server;

    constructor() { }

    private logToFile(message: string) {
        try {
            const logPath = path.resolve(process.cwd(), 'gps-connections.log');
            const timestamp = new Date().toISOString();
            fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
        } catch (err) {
            // Ignore error writing to log
        }
    }

    onApplicationBootstrap() {
        const port = process.env.GPS_TCP_PORT ? parseInt(process.env.GPS_TCP_PORT, 10) : 2102;

        this.server = net.createServer((socket) => {
            const remoteAddress = `${socket.remoteAddress}:${socket.remotePort}`;
            this.logger.log(`Nueva conexión TCP GPS establecida desde ${remoteAddress}`);

            let deviceImei: string | null = null;
            let bufferAccumulator = Buffer.alloc(0);

            socket.on('data', async (data) => {
                this.logger.debug(`[TCP GPS] Datos recibidos de ${remoteAddress}: ${data.toString('hex')}`);
                this.logToFile(`[TCP GPS] Datos recibidos de ${remoteAddress}: ${data.toString('hex')}`);
                bufferAccumulator = Buffer.concat([bufferAccumulator, data]);

                // Procesar el acumulador en bucle ya que pueden llegar múltiples tramas o tramas fragmentadas
                while (bufferAccumulator.length > 0) {
                    if (deviceImei === null) {
                        // Esperando paquete de Handshake de IMEI
                        if (bufferAccumulator.length < 2) {
                            break; // Esperar más datos
                        }
                        const imeiLen = bufferAccumulator.readUInt16BE(0);
                        if (imeiLen < 8 || imeiLen > 30) {
                            this.logger.warn(`[TCP GPS] Longitud de IMEI inválida recibida de ${remoteAddress}: ${imeiLen}. Cerrando socket.`);
                            socket.destroy();
                            break;
                        }
                        if (bufferAccumulator.length < 2 + imeiLen) {
                            break; // Esperar más datos
                        }

                        const imei = bufferAccumulator.toString('ascii', 2, 2 + imeiLen);
                        deviceImei = imei;
                        
                        this.logger.log(`[TCP GPS] IMEI recibido y aceptado para pruebas desde ${remoteAddress}: ${deviceImei}`);
                        this.logToFile(`[TCP GPS] IMEI recibido: ${deviceImei}`);

                        // Responder aceptación de IMEI (1 byte con valor 0x01)
                        socket.write(Buffer.from([0x01]));

                        // Cortar el acumulador para quitar el handshake de IMEI
                        bufferAccumulator = bufferAccumulator.slice(2 + imeiLen);
                    } else {
                        // Esperando tramas de datos AVL
                        if (bufferAccumulator.length < 8) {
                            break; // Esperar más datos (preámbulo 4 bytes + longitud 4 bytes)
                        }

                        // Validar preámbulo (debe ser 0x00000000)
                        const preamble = bufferAccumulator.readUInt32BE(0);
                        if (preamble !== 0) {
                            this.logger.warn(`[TCP GPS] Preámbulo inválido (${preamble}) de ${deviceImei}. Buscando siguiente límite.`);
                            const index = bufferAccumulator.indexOf(Buffer.from([0, 0, 0, 0]));
                            if (index !== -1) {
                                bufferAccumulator = bufferAccumulator.slice(index);
                                continue;
                            } else {
                                if (bufferAccumulator.length > 1024) {
                                    bufferAccumulator = Buffer.alloc(0);
                                }
                                break;
                            }
                        }

                        // Obtener longitud del campo de datos
                        const dataLength = bufferAccumulator.readUInt32BE(4);
                        const expectedLength = 8 + dataLength + 4; // 8 (preámbulo + longitud) + datos + 4 (CRC)

                        if (bufferAccumulator.length < expectedLength) {
                            break; // El paquete está incompleto, esperar más datos
                        }

                        // Extraer el paquete completo y reajustar acumulador
                        const packet = bufferAccumulator.slice(0, expectedLength);
                        bufferAccumulator = bufferAccumulator.slice(expectedLength);

                        try {
                            const parsed = parseAvlData(packet);
                            this.logger.log(`[TCP GPS] Objeto parsed completo: ${JSON.stringify(parsed, null, 2)}`);
                            
                            if (parsed) {
                                this.logger.log(`[TCP GPS] Procesando ${parsed.recordsCount} registros AVL para IMEI: ${deviceImei}`);
                                this.logToFile(`[TCP GPS] Procesando ${parsed.recordsCount} registros AVL para IMEI: ${deviceImei}`);
                                
                                for (const record of parsed.records) {
                                    await this.processTelemetryRecord(deviceImei, record);
                                }

                                // Responder con el número de registros aceptados (4 bytes big-endian)
                                const ack = Buffer.alloc(4);
                                ack.writeUInt32BE(parsed.recordsCount, 0);
                                socket.write(ack);
                            } else {
                                this.logger.warn(`[TCP GPS] Fallo al decodificar AVL para IMEI: ${deviceImei}`);
                            }
                        } catch (err) {
                            this.logger.error(`[TCP GPS] Error procesando AVL para IMEI ${deviceImei}: ${err.message}`, err.stack);
                        }
                    }
                }
            });

            socket.on('close', () => {
                this.logger.log(`[TCP GPS] Conexión cerrada desde ${remoteAddress} (IMEI: ${deviceImei || 'Desconocido'})`);
            });

            socket.on('error', (err) => {
                this.logger.error(`[TCP GPS] Error en socket ${remoteAddress} (IMEI: ${deviceImei || 'Desconocido'}): ${err.message}`);
            });
        });

        this.server.listen(port, '0.0.0.0', () => {
            this.logger.log(`[TCP GPS] Servidor TCP escuchando en el puerto ${port}`);
            this.logToFile(`[TCP GPS] Servidor TCP escuchando en el puerto ${port}`);
        });
    }

    onModuleDestroy() {
        if (this.server) {
            this.server.close(() => {
                this.logger.log('[TCP GPS] Servidor TCP detenido.');
            });
        }
    }

    /**
     * Procesa y simula la recepción del registro TCP para verificar que Python manda la data correctamente.
     */
    async processTelemetryRecord(
        imei: string,
        record: {
            timestamp: Date;
            latitude: number;
            longitude: number;
            speed: number;
            din1?: number | null;
            din2?: number | null;
            dout1?: number | null;
            ain1?: number | null;
            ignition?: number | null;
            externalVoltage?: number | null;
            batteryVoltage?: number | null;
        }
    ) {
        if (record.ignition === 0) {
            record.speed = 0;
        }

        // 🖨️ IMPRESIÓN DIRECTA EN CONSOLA PARA VER QUE PYTHON SÍ LLEGÓ
        this.logger.log(`========================================`);
        this.logger.log(`[TCP GPS RECEPCIÓN EXITOSA]`);
        this.logger.log(`IMEI: ${imei}`);
        this.logger.log(`Latitud: ${record.latitude} | Longitud: ${record.longitude}`);
        this.logger.log(`Velocidad: ${record.speed} km/h | Ignición: ${record.ignition}`);
        this.logger.log(`Timestamp: ${record.timestamp}`);
        this.logger.log(`========================================`);

        this.logToFile(`[TCP GPS] IMEI: ${imei} | Lat: ${record.latitude} | Lng: ${record.longitude}`);
    }

    /**
     * Endpoint REST de prueba para verificar que Python manda peticiones HTTP/REST correctamente.
     */
    async receiveTelemetry(body: GpsBody) {
        this.logger.log(`========================================`);
        this.logger.log(`[REST GPS RECEPCIÓN EXITOSA]`);
        this.logger.log(`Cuerpo recibido desde Python: ${JSON.stringify(body, null, 2)}`);
        this.logger.log(`========================================`);

        this.logToFile(`[REST GPS] Datos recibidos: ${JSON.stringify(body)}`);

        return {
            success: true,
            message: "Datos de Python recibidos e impresos correctamente en consola",
            receivedData: body
        };
    }
}