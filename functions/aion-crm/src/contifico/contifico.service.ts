import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ContificoService {
  constructor(private readonly configService: ConfigService) {}
  /**
   * Convertir fecha de string DD/MM/YYYY a Date.
   * @param dateString Fecha a formatear
   */
  private convertToDate(dateString: string): Date {
    const [day, month, year] = dateString.split('/');
    return new Date(`${year}-${month}-${day}`);
  }

  /**
   * Obtener documentos de Contifico y guardarlos/actualizarlos en Firestore.
   * @param body Datos de la solicitud
   */
  async contificoDocuments(body: any): Promise<string> {
    const db = getFirestore();
    const batch = db.batch();

    try {
      const { fecha } = body;

      if (!fecha) {
        throw new HttpException(
          'BAD REQUEST: Falta el parámetro "fecha"',
          HttpStatus.BAD_REQUEST,
        );
      }

      const date = new Date(fecha);
      let docs = [];

      // Realizar la solicitud a la API de Contifico
      await axios({
        method: 'GET',
        url: `${this.configService.get<string>('CONTIFICO_URI_DOCUMENT')}?tipo_registro=CLI&fecha_emision=${date.toLocaleDateString('en-GB')}`,
        headers: {
          Authorization: this.configService.get<string>('CONTIFICO_AUTH_TOKEN'),
        },
      })
        .then((response) => {
          docs = response.data;
        })
        .catch((err) => {
          console.error(err);
          throw new HttpException(
            'Error al obtener documentos de Contifico',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        });

      // Guardar o actualizar documentos en Firestore
      for (const doc of docs) {
        const data = {
          idDocumento: doc.id,
          fechaCreacion:
            Timestamp.fromDate(this.convertToDate(doc.fecha_creacion)) || null,
          fechaEmision:
            Timestamp.fromDate(this.convertToDate(doc.fecha_emision)) || null,
          estado: doc.estado,
          urlRide: doc.url_ride,
          total: parseFloat(doc.total),
          tipoDocumento: doc.tipo_documento,
          documento: doc.documento,
          descripcion: doc.descripcion,
        };

        const exist = (
          await db
            .collection('documentos')
            .where('idDocumento', '==', doc.id)
            .get()
        ).docs.map((document) => ({
          ref: document.ref,
        }));

        if (exist.length > 0) {
          batch.update(exist[0].ref, data);
        } else {
          const newDocRef = db.collection('documentos').doc();
          batch.create(newDocRef, data);
        }
      }

      await batch.commit();

      return `${docs.length} documentos guardados o actualizados correctamente`;
    } catch (error) {
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
