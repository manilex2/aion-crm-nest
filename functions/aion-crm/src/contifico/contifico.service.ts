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
  async contificoDocuments(): Promise<string> {
    const db = getFirestore();
    const batch = db.batch();

    try {
      const date = new Date();

      // Obtener la fecha en formato DD/MM/YYYY en zona horaria de Ecuador
      const ecuadorDateString = date.toLocaleDateString('en-GB', {
        timeZone: 'America/Guayaquil',
      });
      let docs = [];

      // Realizar la solicitud a la API de Contifico
      await axios({
        method: 'GET',
        url: `${this.configService.get<string>('CONTIFICO_URI_DOCUMENT')}?tipo_registro=CLI&fecha_emision=${ecuadorDateString}`,
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

        const cliente = (
          await db
            .collection('contactos')
            .where('idNumber', '==', doc.cliente.cedula)
            .get()
        ).docs.map((contact) => {
          return contact;
        });

        if (exist.length > 0) {
          if (cliente && cliente.length > 0) {
            const payment = (
              await db
                .collection('payments')
                .where('contactID', '==', cliente[0].ref)
                .where('paymentType', '==', 'alicuota')
                .where('month', '==', date.getMonth() + 1)
                .where('year', '==', date.getFullYear())
                .where('docRelationated', '!=', true)
                .get()
            ).docs.map((pay) => {
              return pay;
            });
            if (payment && payment.length > 0) {
              batch.update(payment[0].ref, {
                idDoc: exist[0].ref,
                docRelationated: true,
              });
            }
          }
          batch.update(exist[0].ref, data);
        } else {
          const newDocRef = db.collection('documentos').doc();
          if (cliente.length > 0) {
            const payment = (
              await db
                .collection('payments')
                .where('contactID', '==', cliente[0].ref)
                .where('month', '==', date.getMonth() + 1)
                .where('year', '==', date.getFullYear())
                .where('docRelationated', '!=', true)
                .get()
            ).docs.map((pay) => {
              return pay;
            });
            if (payment.length > 0) {
              batch.update(payment[0].ref, {
                idDoc: newDocRef,
                docRelationated: true,
              });
            }
          }
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

  /**
   * Actualizar el estado de los documentos en Firestore según el estado actual en Contifico.
   * Consulta los documentos con fechaEmision en los últimos 90 días y actualiza su estado si es necesario.
   */
  async updateDocumentStates(): Promise<string> {
    const db = getFirestore();
    let batch = db.batch();
    let batchCounter = 0;

    try {
      // Obtener la fecha actual en zona horaria de Ecuador
      const today = new Date();
      const todayEcuadorString = today.toLocaleString('en-US', {
        timeZone: 'America/Guayaquil',
      });
      const todayEcuador = new Date(todayEcuadorString);
      todayEcuador.setHours(0, 0, 0, 0);

      // Calcular la fecha de hace 90 días
      const ninetyDaysAgo = new Date(todayEcuador);
      ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

      // Convertir fechas a Timestamps de Firestore
      const todayTimestamp = Timestamp.fromDate(todayEcuador);
      const ninetyDaysAgoTimestamp = Timestamp.fromDate(ninetyDaysAgo);

      // Consultar documentos con fechaEmision entre hace 90 días y hoy
      const documentosSnapshot = await db
        .collection('documentos')
        .where('fechaEmision', '>=', ninetyDaysAgoTimestamp)
        .where('fechaEmision', '<=', todayTimestamp)
        .get();

      const documentos = documentosSnapshot.docs;
      let updatedCount = 0;

      // Procesar cada documento
      for (const doc of documentos) {
        const data = doc.data();
        const idDocumento = data.idDocumento;
        const firestoreEstado = data.estado;

        try {
          // Realizar la solicitud a la API de Contifico
          const response = await axios({
            method: 'GET',
            url: `https://api.contifico.com/sistema/api/v1/documento/${idDocumento}`,
            headers: {
              Authorization: this.configService.get<string>(
                'CONTIFICO_AUTH_TOKEN',
              ),
            },
          })
            .then((response) => {
              return response.data;
            })
            .catch((err) => {
              console.error(err);
              throw new HttpException(
                'Error al obtener documentos de Contifico',
                HttpStatus.INTERNAL_SERVER_ERROR,
              );
            });

          const contificoEstado = response.estado;
          console.log(response);

          // Si el estado es diferente, actualizar el documento en Firestore
          if (firestoreEstado !== contificoEstado) {
            batch.update(doc.ref, { estado: contificoEstado });
            updatedCount++;
            batchCounter++;

            // Limitar el batch a 500 operaciones (límite de Firestore)
            if (batchCounter === 500) {
              await batch.commit();
              batch = db.batch(); // Iniciar un nuevo batch
              batchCounter = 0;
            }
          }
        } catch (err) {
          console.error(
            `Error al obtener el documento ${idDocumento}:`,
            err.message,
          );
          // Continuar con el siguiente documento
        }
      }

      // Confirmar cualquier operación restante en el batch
      if (batchCounter > 0) {
        await batch.commit();
      }

      return `${updatedCount} documentos actualizados correctamente`;
    } catch (error) {
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
