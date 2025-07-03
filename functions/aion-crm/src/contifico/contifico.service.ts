import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  DocumentReference,
  getFirestore,
  Timestamp,
} from 'firebase-admin/firestore';
import axios from 'axios';
import { ConfigService } from '@nestjs/config';
import { GoogleGenAI, Schema, Type } from '@google/genai';

interface ContificoDocument {
  id: string;
  pos: string | null;
  fecha_creacion: string;
  fecha_emision: string;
  hora_emision: string | null;
  tipo_documento: string;
  tipo_registro: string;
  documento: string;
  estado: 'P' | 'A' | 'C' | 'E' | 'G' | 'F';
  anulado: boolean;
  autorizacion: string;
  caja_id: string | null;
  persona_id: string;
  persona: {
    id: string;
    ruc: string;
    cedula: string;
    placa: string | null;
    razon_social: string;
    telefonos: string;
    direccion: string;
    tipo: 'N' | 'J' | 'I' | 'P';
    es_cliente: boolean;
    es_proveedor: boolean;
    es_empleado: boolean;
    es_corporativo: boolean;
    aplicar_cupo: boolean;
    email: string;
    es_vendedor: boolean;
    es_extranjero: boolean;
    porcentaje_descuento: string | null;
    adicional1_cliente: string;
    adicional2_cliente: string;
    adicional3_cliente: string;
    adicional4_cliente: string;
    adicional1_proveedor: string;
    adicional2_proveedor: string;
    adicional3_proveedor: string;
    adicional4_proveedor: string;
    banco_codigo_id: string | null;
    tipo_cuenta: string | null;
    numero_tarjeta: string;
    personaasociada_id: string | null;
    nombre_comercial: string;
    origen: string | null;
    pvp_default: string;
    id_categoria: string | null;
    categoria_nombre: string | null;
  };
  vendedor: string | null;
  vendedor_id: string | null;
  vendedor_identificacion: string | null;
  descripcion: string;
  subtotal_0: string;
  subtotal_12: string;
  subtotal: string;
  iva: string;
  ice: string;
  servicio: string;
  total: string;
  saldo: string;
  saldo_anticipo: string | null;
  adicional1: string;
  adicional2: string;
  detalles: [
    {
      cuenta_id: null | string;
      centro_costo_id: null | string;
      producto_id: string;
      producto_nombre: string;
      cantidad: string;
      precio: string;
      porcentaje_descuento: string;
      porcentaje_iva: null | string;
      porcentaje_ice: null | string;
      valor_ice: string;
      base_cero: string;
      base_gravable: string;
      base_no_gravable: string;
      serie: null | string;
      descripcion: null | string;
      color_id: null | string;
      formula: Array<void> | Array<string>;
      formula_asociada: null | string;
      nombre_manual: null | string;
      peso: null | string;
      volumen: null | string;
      adicional1: null | string;
      codigo_bien: null | string;
      personas_asociadas: null | string;
      promocion_integracionId: null | string;
      ibpnr: string;
    },
  ];
  cobros: [];
  documento_relacionado_id: null | string;
  reserva_relacionada: null | string;
  url_: null | string;
  tarjeta_consumo_id: null | string;
  url_ride: string;
  url_xml: string;
  referencia: string;
  entregado: boolean;
  electronico: boolean;
  logistica: null | string;
  fecha_vencimiento: string;
  tipo_descuento: null | string;
  placa: null | string;
  firmado: boolean;
  fecha_evento: null | string;
  hora_evento: null | string;
  direccion_evento: null | string;
  pax: null | string;
  tipo_domicilio: null | string;
  orden_domicilio_id: null | string;
}

// Interfaz para el resultado esperado de Gemini
interface GeminiAnalysisResult {
  lote: number;
  tipo: 'alicuota' | 'anulacion' | 'otros';
  fechas: Array<{
    month: number;
    year: number;
  }>;
}

@Injectable()
export class ContificoService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Obtener documentos de Contifico y guardarlos/actualizarlos en Firestore.
   * @param body Datos de la solicitud
   */
  async contificoDocuments(): Promise<Array<any>> {
    const ai = new GoogleGenAI({
      apiKey: 'AIzaSyAZegStT7plCyG8yeaeUFgGHvelqAnawI0',
    });
    const db = getFirestore();
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const batch = db.batch();

    try {
      const date = new Date();

      // Obtener la fecha en formato DD/MM/YYYY en zona horaria de Ecuador
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const ecuadorDateString = date.toLocaleDateString('en-GB', {
        timeZone: 'America/Guayaquil',
      });
      let contificoDocs: ContificoDocument[] = [];

      // Realizar la solicitud a la API de Contifico
      await axios({
        method: 'GET',
        url: `${this.configService.get<string>(
          'CONTIFICO_URI',
        )}/registro/documento/?tipo_registro=CLI&fecha_emision=1/7/2025`,
        headers: {
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
      })
        .then((response) => {
          contificoDocs = response.data;
        })
        .catch((err) => {
          console.error('Error al obtener documentos de Contifico:', err);
          throw new HttpException(
            'Error al obtener documentos de Contifico',
            HttpStatus.INTERNAL_SERVER_ERROR,
          );
        });

      if (contificoDocs.length === 0) {
        return [];
      }

      // Obtener la referencia al proyecto único
      const projectSnapshot = await db.collection('projects').limit(1).get();
      if (projectSnapshot.empty) {
        throw new HttpException(
          'No se encontró ningún proyecto en la colección "projects".',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const projectRef = projectSnapshot.docs[0].ref;

      for (const doc of contificoDocs) {
        let geminiAnalysisResult: GeminiAnalysisResult[] | null = null;
        try {
          // El prompt instruccional para Gemini
          const instructionalPrompt = `Analiza la siguiente descripción de un documento de Contifico. Extrae el número de lote, el tipo de pago (siendo "alicuota" para "Alicuota de mantenimiento" o "Alcance de alicuota de mantenimiento", "anulacion" para "Cambio" o "Anulación", y "otros" para cualquier otro caso) y los meses/años a los que corresponde. Genera la respuesta en formato JSON de acuerdo al esquema provisto. Descripción: "${doc.descripcion}"`;

          // Definición del esquema de respuesta esperado
          const responseSchema: Schema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lote: { type: Type.NUMBER },
                tipo: {
                  type: Type.STRING,
                  enum: ['alicuota', 'anulacion', 'otros'],
                },
                fechas: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      month: { type: Type.NUMBER },
                      year: { type: Type.NUMBER },
                    },
                    propertyOrdering: ['month', 'year'],
                    required: ['month', 'year'],
                  },
                },
              },
              propertyOrdering: ['lote', 'tipo', 'fechas'],
              required: ['lote', 'tipo', 'fechas'],
            },
          };

          // Genera el contenido con el modelo Gemini, especificando el esquema
          const result = await ai.models.generateContent({
            model: this.configService.get<string>('GEMINI_MODEL_ID'),
            contents: instructionalPrompt,
            config: {
              responseMimeType: 'application/json',
              responseSchema: responseSchema, // Pasa el esquema directamente
            },
          });

          // La librería oficial ya parsea la respuesta JSON por ti
          const textResponse = result.text;

          if (textResponse) {
            try {
              geminiAnalysisResult = JSON.parse(textResponse);
            } catch (parseError) {
              console.error(
                'Error al parsear la respuesta JSON de Gemini:',
                parseError,
              );
              throw new Error('La respuesta de Gemini no es un JSON válido.');
            }
          } else {
            throw new Error(
              'La respuesta de Gemini está vacía o no contiene texto.',
            );
          }

          // Validaciones para asegurar el formato esperado
          if (
            !Array.isArray(geminiAnalysisResult) ||
            geminiAnalysisResult.length === 0
          ) {
            throw new Error(
              'La respuesta de Gemini no es un array válido o está vacío después de parsear.',
            );
          }
          for (const item of geminiAnalysisResult) {
            if (
              typeof item.lote !== 'number' ||
              !['alicuota', 'anulacion', 'otros'].includes(item.tipo) ||
              !Array.isArray(item.fechas) ||
              item.fechas.length === 0 ||
              item.fechas.some(
                (f) =>
                  typeof f.month !== 'number' || typeof f.year !== 'number',
              )
            ) {
              throw new Error(
                'Formato de análisis de Gemini inválido para un elemento.',
              );
            }
          }
        } catch (geminiErr) {
          console.warn(
            `Error al analizar la descripción con Gemini para el documento ${doc.id}:`,
            geminiErr.message ||
              (geminiErr as any).response?.data ||
              JSON.stringify(geminiErr), // Captura más detalles
          );
          continue; // Salta al siguiente documento si Gemini falla
        }

        console.log(geminiAnalysisResult);

        /* // 2. Buscar el contactID usando la cédula
        const contactSnapshot = await db
          .collection('contactos')
          .where('cedula', '==', doc.persona.cedula)
          .limit(1)
          .get();

        let contactRef: DocumentReference | null = null;
        if (!contactSnapshot.empty) {
          contactRef = contactSnapshot.docs[0].ref;
        } else {
          console.warn(
            `Contacto con cédula ${doc.persona.cedula} no encontrado para el documento ${doc.id}. Se creará el payment sin contactID.`,
          );
        }

        // Iterar sobre los resultados de Gemini (que es un array)
        for (const analysisResult of geminiAnalysisResult) {
          // 3. Buscar el unidadID usando el número de lote de Gemini
          const unitSnapshot = await db
            .collection('housingUnits')
            .where('unitNumber', '==', analysisResult.lote) // Asume unitNumber es string si lote es number
            .limit(1)
            .get();

          let unidadRef: DocumentReference | null = null;
          if (!unitSnapshot.empty) {
            unidadRef = unitSnapshot.docs[0].ref;
          } else {
            console.warn(
              `Unidad de vivienda con lote ${analysisResult.lote} no encontrada para el documento ${doc.id}. Se creará el payment sin unidadID.`,
            );
          }

          // 4. Determinar el tipo de pago
          let paymentType: string;
          if (analysisResult.tipo === 'alicuota') {
            paymentType = 'alicuota';
          } else if (analysisResult.tipo === 'anulacion') {
            paymentType = 'anulacion';
          } else {
            paymentType = 'otros';
          }

          // Crear un payment por cada mes/año devuelto por Gemini para este lote
          for (const fecha of analysisResult.fechas) {
            // Validar si el payment ya existe para evitar duplicados
            // Es crucial para evitar que cada ejecución cree pagos duplicados si los documentos de Contifico se consultan múltiples veces.
            const existingPaymentSnapshot = await db
              .collection('payments')
              .where('idDocContifico', '==', doc.id)
              .where('month', '==', fecha.month)
              .where('year', '==', fecha.year)
              .where('contactID', '==', contactRef)
              .limit(1)
              .get();

            if (!existingPaymentSnapshot.empty) {
              console.log(
                `Payment para documento Contifico ${doc.id}, mes ${fecha.month}, año ${fecha.year} y contacto ${doc.persona.cedula} ya existe. Saltando creación.`,
              );
              continue; // Saltar si el pago ya existe para este documento y período
            }

            const newPaymentRef = db.collection('payments').doc();
            const paymentData = {
              contactID: contactRef,
              projectID: projectRef,
              unidadID: unidadRef,
              planDate: Timestamp.fromDate(
                new Date(fecha.year, fecha.month, 1),
              ), // 1 del mes siguiente del payment
              realDate: null,
              isPaid: false,
              totalValue: parseFloat(doc.total),
              paymentValue: 0.0,
              balance: parseFloat(doc.total),
              paymentType: paymentType,
              paymentMethod: null,
              paymentNumber: null,
              lastFollowStatus: null,
              paymentSupportPdf: doc.url_ride || null,
              paymentName: doc.descripcion, // Puedes usar la descripción de Contifico como nombre del pago
              paymentSupportImg: null,
              landID: null, // Ignorado
              msgSendPrev: false,
              msgSendCob: false,
              paymentSupport: [], // Array vacío
              registerDate: Timestamp.fromDate(new Date()), // Fecha actual
              month: fecha.month,
              year: fecha.year,
              docRelationated: true, // Siempre true, ya que está relacionado con un doc de Contifico
              idDocContifico: doc.id, // Guardar el ID original de Contifico
              docFactura: doc.documento, // Número de documento de Contifico
            };

            batch.set(newPaymentRef, paymentData); // Crea el nuevo documento en 'payments'
          }
        } */
      }

      // await batch.commit();

      return contificoDocs; // Retorna los documentos de Contifico procesados
    } catch (error) {
      console.error('Error general en contificoDocuments:', error);
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
