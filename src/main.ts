import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  
  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0'); // <--- ¡Esto le avisa a Railway que acepte tráfico externo!
  
  console.log(`Servidor corriendo en el puerto ${port}`);
}
bootstrap();