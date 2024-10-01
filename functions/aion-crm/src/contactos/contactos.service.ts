import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { getFirestore } from 'firebase-admin/firestore';

@Injectable()
export class ContactosService {
  async exportContactsToCSV(): Promise<string> {
    try {
      const db = getFirestore();
      const contactosSnapshot = await db.collection('contactos').get();

      if (contactosSnapshot.empty) {
        throw new HttpException(
          'NOT FOUND: No se encontraron contactos',
          HttpStatus.NOT_FOUND,
        );
      }

      const contactosData = contactosSnapshot.docs.map((doc) => ({
        id: doc.id,
        phone: doc.data().phone,
      }));

      // Crear el CSV
      const csvContent = this.arrayToCSV(contactosData);
      return csvContent;
    } catch (error) {
      this.handleError(error);
    }
  }

  private arrayToCSV(data: { id: string; phone: string }[]): string {
    const headers = ['id', 'phone'];
    const records = data.map((contacto) => [contacto.id, contacto.phone]);
    return [headers.join(','), ...records].join('\n');
  }

  private handleError(error: any) {
    const errorMessage = error.message || 'Ocurrió un error desconocido';

    if (errorMessage.startsWith('BAD REQUEST')) {
      throw new HttpException(
        `Solicitud incorrecta: ${errorMessage}`,
        HttpStatus.BAD_REQUEST,
      );
    } else if (errorMessage.startsWith('UNAUTHORIZED')) {
      throw new HttpException(
        `Error de autorización: ${errorMessage}`,
        HttpStatus.UNAUTHORIZED,
      );
    } else if (errorMessage.startsWith('FORBIDDEN')) {
      throw new HttpException(
        `Prohibido: ${errorMessage}`,
        HttpStatus.FORBIDDEN,
      );
    } else if (errorMessage.startsWith('NOT FOUND')) {
      throw new HttpException(
        `Recurso no encontrado: ${errorMessage}`,
        HttpStatus.NOT_FOUND,
      );
    } else if (errorMessage.startsWith('CONFLICT')) {
      throw new HttpException(
        `Conflicto: ${errorMessage}`,
        HttpStatus.CONFLICT,
      );
    } else {
      throw new HttpException(
        `Error interno del servidor: ${errorMessage}`,
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
