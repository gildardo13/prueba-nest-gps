export interface AvlRecord {
  timestamp: Date;
  priority: number;
  latitude: number;
  longitude: number;
  altitude: number;
  angle: number;
  satellites: number;
  speed: number;
  din1?: number | null;
  din2?: number | null;
  dout1?: number | null;
  ain1?: number | null;
  ignition?: number | null;
  externalVoltage?: number | null;
  batteryVoltage?: number | null;
}

export interface ParsedAvlData {
  codecId: number;
  recordsCount: number;
  records: AvlRecord[];
}

/**
 * Decodifica un paquete binario de datos AVL de Teltonika (soporta Codec 8 y Codec 8 Extended).
 * @param buffer El búfer binario recibido.
 * @returns Los datos decodificados o null si no es un paquete AVL válido o completo.
 */
export function parseAvlData(buffer: Buffer): ParsedAvlData | null {
  // El paquete mínimo con 1 registro requiere alrededor de 45 bytes,
  // pero el encabezado mínimo de metadatos del paquete son 10 bytes:
  // 4 (preamble) + 4 (length) + 1 (codec) + 1 (records count)
  if (buffer.length < 10) return null;

  let offset = 0;

  // 1. Preamble: 4 bytes (siempre 0x00000000)
  const preamble = buffer.readUInt32BE(offset);
  if (preamble !== 0) {
    return null;
  }
  offset += 4;

  // 2. Data Field Length: 4 bytes
  const dataLength = buffer.readUInt32BE(offset);
  offset += 4;

  // Comprobar si tenemos el paquete completo en el búfer
  // La longitud total del paquete esperado es: 4 (preamble) + 4 (length) + dataLength + 4 (CRC)
  // El total de datos útiles + CRC es dataLength + 4
  if (buffer.length < 8 + dataLength + 4) {
    return null; // Aún no ha llegado el paquete completo
  }

  // 3. Codec ID: 1 byte
  const codecId = buffer.readUInt8(offset);
  offset += 1;

  if (codecId !== 0x08 && codecId !== 0x8e) {
    // Codec no soportado (solo soportamos Codec 8 y Codec 8 Extended)
    return null;
  }

  // 4. Number of Data 1: 1 byte
  const recordsCount = buffer.readUInt8(offset);
  offset += 1;

  const records: AvlRecord[] = [];

  for (let i = 0; i < recordsCount; i++) {
    // Si no quedan suficientes bytes para leer la parte de GPS básica (mínimo 24 bytes)
    if (offset + 24 > buffer.length) break;

    // Timestamp: 8 bytes (milisegundos desde la época UTC)
    const timestampMs = Number(buffer.readBigUInt64BE(offset));
    offset += 8;

    // Priority: 1 byte
    const priority = buffer.readUInt8(offset);
    offset += 1;

    // GPS Element:
    // Longitud: 4 bytes (entero de 32 bits con signo)
    const lonInt = buffer.readInt32BE(offset);
    offset += 4;
    const longitude = lonInt / 10000000;

    // Latitud: 4 bytes (entero de 32 bits con signo)
    const latInt = buffer.readInt32BE(offset);
    offset += 4;
    const latitude = latInt / 10000000;

    // Altura (Altitude): 2 bytes (entero de 16 bits con signo, metros)
    const altitude = buffer.readInt16BE(offset);
    offset += 2;

    // Ángulo (Angle): 2 bytes (entero de 16 bits sin signo, grados)
    const angle = buffer.readUInt16BE(offset);
    offset += 2;

    // Satélites: 1 byte (entero de 8 bits sin signo)
    const satellites = buffer.readUInt8(offset);
    offset += 1;

    // Velocidad: 2 bytes (entero de 16 bits sin signo, km/h)
    const speed = buffer.readUInt16BE(offset);
    offset += 2;

    let din1: number | null = null;
    let din2: number | null = null;
    let dout1: number | null = null;
    let ain1: number | null = null;
    let ignition: number | null = null;
    let externalVoltage: number | null = null;
    let batteryVoltage: number | null = null;


    // Parseo de I/O Elements
    if (codecId === 0x08) {
      // Codec 8 I/O elements
      if (offset + 2 > buffer.length) break;
      const eventId = buffer.readUInt8(offset);
      offset += 1;
      const totalIo = buffer.readUInt8(offset);
      offset += 1;

      // M1 (1 byte IO)
      if (offset + 1 > buffer.length) break;
      const m1Count = buffer.readUInt8(offset);
      offset += 1;
      for (let j = 0; j < m1Count; j++) {
        if (offset + 2 > buffer.length) break;
        const id = buffer.readUInt8(offset);
        const val = buffer.readUInt8(offset + 1);
        offset += 2;
        if (id === 1) din1 = val;
        else if (id === 2) din2 = val;
        else if (id === 179) dout1 = val;
        else if (id === 239) ignition = val;
      }

      // M2 (2 bytes IO)
      if (offset + 1 > buffer.length) break;
      const m2Count = buffer.readUInt8(offset);
      offset += 1;
      for (let j = 0; j < m2Count; j++) {
        if (offset + 3 > buffer.length) break;
        const id = buffer.readUInt8(offset);
        const val = buffer.readUInt16BE(offset + 1);
        offset += 3;
        if (id === 9) ain1 = val;
        else if (id === 66) externalVoltage = val;
        else if (id === 67 || id === 113) batteryVoltage = val;
      }

      // M4 (4 bytes IO)
      if (offset + 1 > buffer.length) break;
      const m4Count = buffer.readUInt8(offset);
      offset += 1;
      offset += m4Count * 5; // Cada uno: 1 byte ID + 4 bytes valor

      // M8 (8 bytes IO)
      if (offset + 1 > buffer.length) break;
      const m8Count = buffer.readUInt8(offset);
      offset += 1;
      offset += m8Count * 9; // Cada uno: 1 byte ID + 8 bytes valor

    } else if (codecId === 0x8e) {
      // Codec 8 Extended I/O elements
      if (offset + 4 > buffer.length) break;
      const eventId = buffer.readUInt16BE(offset);
      offset += 2;
      const totalIo = buffer.readUInt16BE(offset);
      offset += 2;

      // M1 (1 byte IO)
      if (offset + 2 > buffer.length) break;
      const m1Count = buffer.readUInt16BE(offset);
      offset += 2;
      for (let j = 0; j < m1Count; j++) {
        if (offset + 3 > buffer.length) break;
        const id = buffer.readUInt16BE(offset);
        const val = buffer.readUInt8(offset + 2);
        offset += 3;
        if (id === 1) din1 = val;
        else if (id === 2) din2 = val;
        else if (id === 179) dout1 = val;
        else if (id === 239) ignition = val;
      }

      // M2 (2 bytes IO)
      if (offset + 2 > buffer.length) break;
      const m2Count = buffer.readUInt16BE(offset);
      offset += 2;
      for (let j = 0; j < m2Count; j++) {
        if (offset + 4 > buffer.length) break;
        const id = buffer.readUInt16BE(offset);
        const val = buffer.readUInt16BE(offset + 2);
        offset += 4;
        if (id === 9) ain1 = val;
        else if (id === 66) externalVoltage = val;
        else if (id === 67 || id === 113) batteryVoltage = val;
      }

      // M4 (4 bytes IO)
      if (offset + 2 > buffer.length) break;
      const m4Count = buffer.readUInt16BE(offset);
      offset += 2;
      offset += m4Count * 6; // Cada uno: 2 bytes ID + 4 bytes valor

      // M8 (8 bytes IO)
      if (offset + 2 > buffer.length) break;
      const m8Count = buffer.readUInt16BE(offset);
      offset += 2;
      offset += m8Count * 10; // Cada uno: 2 bytes ID + 8 bytes valor

      // MX (Variable length IO)
      if (offset + 2 > buffer.length) break;
      const mxCount = buffer.readUInt16BE(offset);
      offset += 2;
      for (let j = 0; j < mxCount; j++) {
        if (offset + 4 > buffer.length) break;
        const ioId = buffer.readUInt16BE(offset);
        offset += 2;
        const ioLen = buffer.readUInt16BE(offset);
        offset += 2;
        offset += ioLen;
      }
    }

    records.push({
      timestamp: new Date(timestampMs),
      priority,
      latitude,
      longitude,
      altitude,
      angle,
      satellites,
      speed,
      din1: din1 !== null && din1 !== undefined ? din1 : 0,
      din2: din2 !== null && din2 !== undefined ? din2 : 0,
      dout1: dout1 !== null && dout1 !== undefined ? dout1 : 0,
      ain1: ain1 !== null && ain1 !== undefined ? ain1 : 0,
      ignition,
      externalVoltage,
      batteryVoltage,
    });
  }

  return {
    codecId,
    recordsCount,
    records,
  };
}
