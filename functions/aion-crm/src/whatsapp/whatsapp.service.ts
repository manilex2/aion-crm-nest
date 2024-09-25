import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { DateTime } from 'luxon';

@Injectable()
export class WhatsappService {
  constructor(private readonly configService: ConfigService) {}

  private readonly apiUrl = 'https://graph.facebook.com/v12.0';
  private readonly accessToken = this.configService.get<string>(
    'WHATSAPP_ACCESS_TOKEN',
  );
  private readonly phoneNumberId = this.configService.get<string>(
    'WHATSAPP_PHONE_NUMBER_ID',
  );

  /**
   * Calcular timestamps sumando días a una fecha.
   * @param now Fecha actual
   * @param days Número de días a sumar/restar
   * @return Timestamps calculados
   */
  private calculateTimestamps(now: Timestamp, days: number): Timestamp {
    return Timestamp.fromMillis(now.toMillis() + days * 24 * 60 * 60 * 1000);
  }

  /**
   * Procesar pagos pendientes y calcular los totales.
   * @param payments Snapshot de pagos
   * @param tipoPago Tipo de pago (alicuota o cuota)
   * @return Objeto con el monto total, cantidad y fechas
   */
  private async processPayments(payments: any[], tipoPago: string) {
    const result = {
      monto: 0,
      cantidad: 0,
      fechas: [],
      idsPago: [],
    };

    payments.forEach((paymentDoc: { data: () => any; id: any }) => {
      const paymentData = paymentDoc.data();
      if (paymentData.paymentType === tipoPago) {
        result.monto += paymentData.balance;
        result.cantidad += 1;
        result.fechas.push(paymentData.planDate.toDate());
        result.idsPago.push(paymentDoc.id);
      }
    });

    return result;
  }

  /**
   * Crear el mensaje basado en el template de WhatsApp con los datos dinámicos.
   * @param contacto Datos del contacto
   * @param alicuotas Datos de las alícuotas
   * @param cuotas Datos de las cuotas
   * @param tipo Tipo de notificación (futuro o vencido)
   * @return Object Template data para WhatsApp API
   */
  private createTemplateData(
    contacto: { [x: string]: any; name?: any },
    alicuotas: { monto: any; cantidad: any; fechas?: any[]; idsPago?: any[] },
    cuotas: { monto: any; cantidad: any; fechas?: any[]; idsPago?: any[] },
    tipo: string,
  ) {
    let templateData: {
      name: string;
      language: { policy: string; code: string };
      components:
        | {
            type: string;
            parameters: (
              | { type: string; text: any }
              | {
                  type: string;
                  currency: {
                    fallback_value: string;
                    code: string;
                    amount_1000: number;
                  };
                }
              | {
                  type: string;
                  date_time: {
                    fallback_value: string;
                    day_of_week: number;
                    day_of_month: number;
                    year: number;
                    month: number;
                    hour: number;
                    minute: number;
                  };
                }
            )[];
          }[]
        | {
            type: string;
            parameters: (
              | { type: string; text: any }
              | {
                  type: string;
                  currency: {
                    fallback_value: string;
                    code: string;
                    amount_1000: number;
                  };
                }
            )[];
          }[];
    };

    if (alicuotas.cantidad >= 1 && cuotas.cantidad >= 1 && tipo === 'vencido') {
      templateData = {
        name: 'pagos_pendientes_total',
        language: { policy: 'deterministic', code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: contacto.name },
              { type: 'text', text: 'AION CRM' },
              { type: 'text', text: cuotas.cantidad },
              {
                type: 'currency',
                currency: {
                  fallback_value: `$${cuotas.monto}`,
                  code: 'USD',
                  amount_1000: cuotas.monto * 1000,
                },
              },
              { type: 'text', text: alicuotas.cantidad },
              {
                type: 'currency',
                currency: {
                  fallback_value: `USD${alicuotas.monto}`,
                  code: 'USD',
                  amount_1000: alicuotas.monto * 1000,
                },
              },
              {
                type: 'currency',
                currency: {
                  fallback_value: `USD${alicuotas.monto + cuotas.monto}`,
                  code: 'USD',
                  amount_1000: (alicuotas.monto + cuotas.monto) * 1000,
                },
              },
            ],
          },
        ],
      };
    } else if (
      (alicuotas.cantidad >= 2 || cuotas.cantidad >= 2) &&
      tipo === 'vencido'
    ) {
      templateData = {
        name: 'pagos_pendientes',
        language: { policy: 'deterministic', code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: contacto.name },
              { type: 'text', text: 'AION CRM' },
              {
                type: 'text',
                text:
                  alicuotas.cantidad > 0 ? alicuotas.cantidad : cuotas.cantidad,
              },
              {
                type: 'text',
                text: alicuotas.cantidad > 0 ? 'alicuotas' : 'cuotas',
              },
              {
                type: 'currency',
                currency: {
                  fallback_value: `$${alicuotas.monto > 0 ? alicuotas.monto : cuotas.monto}`,
                  code: 'USD',
                  amount_1000:
                    alicuotas.monto > 0
                      ? alicuotas.monto * 1000
                      : cuotas.monto * 1000,
                },
              },
            ],
          },
        ],
      };
    } else if (
      (alicuotas.cantidad === 1 || cuotas.cantidad === 1) &&
      tipo === 'vencido'
    ) {
      const fecha =
        alicuotas.cantidad > 0
          ? DateTime.fromJSDate(alicuotas.fechas[0])
          : DateTime.fromJSDate(cuotas.fechas[0]);
      templateData = {
        name: 'pago_por_pagar',
        language: { policy: 'deterministic', code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: contacto.name },
              { type: 'text', text: 'AION CRM' },
              {
                type: 'text',
                text: alicuotas.cantidad > 0 ? 'alicuotas' : 'cuotas',
              },
              {
                type: 'date_time',
                date_time: {
                  fallback_value: `${fecha.setLocale('es-EC').toLocaleString(DateTime.DATE_FULL)}`,
                  day_of_week: fecha.weekday,
                  day_of_month: fecha.day,
                  year: fecha.year,
                  month: fecha.month,
                  hour: fecha.hour,
                  minute: fecha.minute,
                },
              },
              {
                type: 'currency',
                currency: {
                  fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
                  code: 'USD',
                  amount_1000:
                    alicuotas.cantidad > 0
                      ? alicuotas.monto * 1000
                      : cuotas.monto * 1000,
                },
              },
            ],
          },
        ],
      };
    } else if (
      alicuotas.cantidad >= 1 &&
      cuotas.cantidad >= 1 &&
      tipo === 'futuro'
    ) {
      templateData = {
        name: 'pagos_proximos_total',
        language: { policy: 'deterministic', code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: contacto.name },
              { type: 'text', text: 'AION CRM' },
              { type: 'text', text: cuotas.cantidad },
              {
                type: 'currency',
                currency: {
                  fallback_value: `$${cuotas.monto}`,
                  code: 'USD',
                  amount_1000: cuotas.monto * 1000,
                },
              },
              { type: 'text', text: alicuotas.cantidad },
              {
                type: 'currency',
                currency: {
                  fallback_value: `USD${alicuotas.monto}`,
                  code: 'USD',
                  amount_1000: alicuotas.monto * 1000,
                },
              },
              {
                type: 'currency',
                currency: {
                  fallback_value: `USD${alicuotas.monto + cuotas.monto}`,
                  code: 'USD',
                  amount_1000: (alicuotas.monto + cuotas.monto) * 1000,
                },
              },
            ],
          },
        ],
      };
    } else if (
      (alicuotas.cantidad >= 2 || cuotas.cantidad >= 2) &&
      tipo === 'futuro'
    ) {
      templateData = {
        name: 'pagos_proximos_tipo',
        language: { policy: 'deterministic', code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: contacto.name },
              { type: 'text', text: 'AION CRM' },
              {
                type: 'text',
                text:
                  alicuotas.cantidad > 0 ? alicuotas.cantidad : cuotas.cantidad,
              },
              {
                type: 'text',
                text: alicuotas.cantidad > 0 ? 'alicuotas' : 'cuotas',
              },
              {
                type: 'currency',
                currency: {
                  fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
                  code: 'USD',
                  amount_1000:
                    alicuotas.cantidad > 0
                      ? alicuotas.monto * 1000
                      : cuotas.monto * 1000,
                },
              },
            ],
          },
        ],
      };
    } else if (
      (alicuotas.cantidad === 1 || cuotas.cantidad === 1) &&
      tipo === 'futuro'
    ) {
      const fecha =
        alicuotas.cantidad > 0
          ? DateTime.fromJSDate(alicuotas.fechas[0])
          : DateTime.fromJSDate(cuotas.fechas[0]);
      templateData = {
        name: 'pago_proximo',
        language: { policy: 'deterministic', code: 'es' },
        components: [
          {
            type: 'body',
            parameters: [
              { type: 'text', text: contacto.name },
              { type: 'text', text: 'AION CRM' },
              {
                type: 'text',
                text: alicuotas.cantidad > 0 ? 'alicuotas' : 'cuotas',
              },
              {
                type: 'date_time',
                date_time: {
                  fallback_value: `${fecha.setLocale('es-EC').toLocaleString(DateTime.DATE_FULL)}`,
                  day_of_week: fecha.weekday,
                  day_of_month: fecha.day,
                  year: fecha.year,
                  month: fecha.month,
                  hour: fecha.hour,
                  minute: fecha.minute,
                },
              },
              {
                type: 'currency',
                currency: {
                  fallback_value: `$${alicuotas.cantidad > 0 ? alicuotas.monto : cuotas.monto}`,
                  code: 'USD',
                  amount_1000:
                    alicuotas.cantidad > 0
                      ? alicuotas.monto * 1000
                      : cuotas.monto * 1000,
                },
              },
            ],
          },
        ],
      };
    }

    // Agregar más lógica para otros templates según sea necesario
    return templateData;
  }

  /**
   * Enviar un mensaje de plantilla a través de la API de WhatsApp Business.
   * @param recipientNumber Número de teléfono del destinatario
   * @param templateData Datos del template
   */
  private async sendTemplateMessage(
    recipientNumber: string,
    templateData: any,
  ): Promise<void> {
    const url = `${this.apiUrl}/${this.phoneNumberId}/messages`;

    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          to: recipientNumber,
          type: 'template',
          template: templateData,
        },
        {
          headers: {
            Authorization: `Bearer ${this.accessToken}`,
            'Content-Type': 'application/json',
          },
        },
      );
      console.log('Mensaje enviado con éxito:', response.data);
    } catch (error) {
      console.error(
        'Error al enviar el mensaje:',
        error.response?.data || error.message,
      );
      throw new HttpException(
        'Error al enviar el mensaje de WhatsApp',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Lógica principal para enviar notificaciones de WhatsApp.
   */
  async sendNotifications(): Promise<void> {
    const db = getFirestore();
    const now = Timestamp.now();
    const diasDesdeHoy = this.calculateTimestamps(now, -10);
    const diasDespuesHoy = this.calculateTimestamps(now, 5);

    const contactos = await db.collection('contactos').get();

    for (const doc of contactos.docs) {
      const contacto = doc.data();
      const payments = await db
        .collection('payments')
        .where('contactID', '==', doc.ref)
        .where('isPaid', '==', false)
        .where('planDate', '>=', diasDesdeHoy)
        .where('planDate', '<=', now)
        .get();

      const filteredPayments = payments.docs.filter((paymentDoc) => {
        const paymentData = paymentDoc.data();
        return (
          paymentData.msgSendCob === false || !('msgSendCob' in paymentData)
        );
      });

      if (filteredPayments.length === 0) {
        console.log(
          `No se encontraron pagos pendientes para el contacto: ${doc.id}`,
        );
        continue;
      }

      const alicuotas = await this.processPayments(
        filteredPayments,
        'alicuota',
      );
      const cuotas = await this.processPayments(filteredPayments, 'cuota');

      const templateData = this.createTemplateData(
        contacto,
        alicuotas,
        cuotas,
        'vencido',
      );
      await this.sendTemplateMessage(
        this.configService.get<string>('RECIPIENT_NUMBER'),
        templateData,
      );

      for (const id of [...alicuotas.idsPago, ...cuotas.idsPago]) {
        const paymentRef = db.collection('payments').doc(id);
        await paymentRef.update({ msgSendCob: true });
      }
    }

    // Procesar pagos futuros
    for (const doc of contactos.docs) {
      const contacto = doc.data();
      const paymentsFuture = await db
        .collection('payments')
        .where('contactID', '==', doc.ref)
        .where('isPaid', '==', false)
        .where('planDate', '>=', diasDespuesHoy)
        .get();

      const filteredPaymentsFuture = paymentsFuture.docs.filter(
        (paymentDoc) => {
          const paymentData = paymentDoc.data();
          return (
            paymentData.msgSendPrev === false || !('msgSendPrev' in paymentData)
          );
        },
      );

      if (filteredPaymentsFuture.length === 0) {
        console.log(
          `No se encontraron pagos futuros para el contacto: ${doc.id}`,
        );
        continue;
      }

      const alicuotasFuturas = await this.processPayments(
        filteredPaymentsFuture,
        'alicuota',
      );
      const cuotasFuturas = await this.processPayments(
        filteredPaymentsFuture,
        'cuota',
      );

      const templateDataFuture = this.createTemplateData(
        contacto,
        alicuotasFuturas,
        cuotasFuturas,
        'futuro',
      );
      await this.sendTemplateMessage(
        this.configService.get<string>('RECIPIENT_NUMBER'),
        templateDataFuture,
      );

      for (const id of [
        ...alicuotasFuturas.idsPago,
        ...cuotasFuturas.idsPago,
      ]) {
        const paymentRef = db.collection('payments').doc(id);
        await paymentRef.update({ msgSendPrev: true });
      }
    }
  }
}
