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
  cobros: null | Array<Cobro>;
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

interface Cobro {
  forma_cobro: string; // Ej: 'Efectivo', 'Transferencia', 'Cheque', 'Tarjeta de Credito'
  fecha: string; // Formato DD/MM/YYYY
  monto: string; // El monto del cobro como string, deberá ser parseado a float
}

// Define una interfaz para los datos del documento de Contifico que esperas recibir de la API
interface ContificoApiDocument {
  id: string; // El ID del documento en Contifico
  estado: 'P' | 'A' | 'C' | 'E' | 'G' | 'F'; // El estado del documento en Contifico
  cobros: Cobro[]; // Añadido el array de cobros
  total: string;
}

// Interfaz para el resultado esperado de Gemini
interface GeminiAnalysisResult {
  lote?: number;
  tipo: 'alicuota' | 'anulacion' | 'afiliacion' | 'otros';
  fechas?: Array<{
    month: number;
    year: number;
  }>;
  montoLote?: number; // Nuevo campo opcional para el monto específico por lote
}

// Nueva interfaz para el retorno de la función
interface ContificoProcessingStats {
  created: {
    alicuota: number;
    anulacion: number;
    afiliacion: number;
    otros: number;
  };
  skipped: {
    alicuota: number;
    anulacion: number;
    afiliacion: number;
    otros: number;
    noUnit: number; // Para casos donde falta unidad
    noContact: 0; // Para casos donde falta contacto
    geminiError: number; // Para errores de Gemini
    contificoApiError: number; // Para errores de la API de Contifico
  };
  updated: {
    // Para el caso específico de anulación de pagos existentes
    anulacion: number;
  };
  totalContificoDocsProcessed: number;
}

@Injectable()
export class ContificoService {
  constructor(private readonly configService: ConfigService) {}

  /**
   * Obtener documentos de Contifico y guardarlos/actualizarlos en Firestore.
   * @param ecuadorDateString La fecha en formato DD/MM/YYYY para buscar documentos en Contifico.
   */
  async contificoDocuments(
    ecuadorDateString?: string,
  ): Promise<ContificoProcessingStats> {
    const ai = new GoogleGenAI({
      apiKey: this.configService.get<string>('GEMINI_API_KEY'),
    });
    const db = getFirestore();
    let batch = db.batch(); // Asegúrate de que el batch se reinicie o se maneje correctamente si hay muchos documentos
    let batchCounter = 0; // Contador de operaciones en el batch

    const stats: ContificoProcessingStats = {
      created: { alicuota: 0, anulacion: 0, afiliacion: 0, otros: 0 },
      skipped: {
        alicuota: 0,
        anulacion: 0,
        afiliacion: 0,
        otros: 0,
        noContact: 0, // Nuevo contador
        noUnit: 0,
        geminiError: 0,
        contificoApiError: 0,
      },
      updated: { anulacion: 0 },
      totalContificoDocsProcessed: 0,
    };

    try {
      // Si ecuadorDateString no se provee, calcula la fecha actual en Ecuador
      if (!ecuadorDateString) {
        const date = new Date();
        ecuadorDateString = date.toLocaleDateString('en-GB', {
          timeZone: 'America/Guayaquil',
        });
      }
      let contificoDocs: ContificoDocument[] = [];

      // Realizar la solicitud a la API de Contifico
      await axios({
        method: 'GET',
        url: `${this.configService.get<string>(
          'CONTIFICO_URI',
        )}/registro/documento/?tipo_registro=CLI&fecha_emision=${ecuadorDateString}`,
        headers: {
          Authorization: this.configService.get<string>('CONTIFICO_API_KEY'),
        },
      })
        .then((response) => {
          contificoDocs = response.data;
          console.log(
            `[${ecuadorDateString}] Documentos de Contifico obtenidos: ${contificoDocs.length}`,
          );
        })
        .catch((err) => {
          console.error(
            `[${ecuadorDateString}] Error al obtener documentos de Contifico:`,
            err.response?.data || err.message,
          );
          stats.skipped.contificoApiError = 1; // Un error por día de API
          // !--- Retornar aquí para detener la ejecución en caso de error de la API ---!
          return stats;
        });

      stats.totalContificoDocsProcessed = contificoDocs.length;

      // Obtener la referencia al proyecto único
      const projectSnapshot = await db
        .collection('projects')
        .where('name', '==', 'VISTALMAR')
        .limit(1)
        .get();
      if (projectSnapshot.empty) {
        throw new HttpException(
          'No se encontró ningún proyecto en la colección "projects".',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      const projectRef = projectSnapshot.docs[0].ref;

      // Función auxiliar para registrar errores
      const logContificoError = (
        idContifico: string,
        description: string,
        errorBatch: FirebaseFirestore.WriteBatch, // Pasamos el batch actual para no romper la atomisidad
        factura: string,
      ) => {
        const logRef = db.collection('logContifico').doc();
        errorBatch.set(
          logRef,
          {
            idContifico: idContifico,
            description: description,
            timestamp: Timestamp.fromDate(new Date()),
            factura: factura,
          },
          { merge: true },
        ); // Usar merge para actualizar si ya existe o crear
        console.error(
          `[LOG ERROR] Documento Contifico ${idContifico}: ${description}`,
        );
      };

      for (const doc of contificoDocs) {
        let geminiAnalysisResult: GeminiAnalysisResult[] | null = null;
        try {
          // El prompt instruccional para Gemini
          const instructionalPrompt = `Analiza la siguiente Descripción de un documento de Contifico y su NombreComercial. Extrae la siguiente información y genera la respuesta en formato JSON de acuerdo al esquema provisto:
          - **Número de lote**: Si la descripción contiene un rango de lotes (ej. "Lote 24-27"), considera cada lote individualmente (24, 27 - no como 24, 25, 26, 27). Si es "alicuota" y el lote no está en Descripción, búscalo en NombreComercial.
          - **Tipo de pago**: "alicuota" para "Alicuota de mantenimiento" o "Alcance de alicuota de mantenimiento", "anulacion" para "Corrección" o "Anulación", "afiliacion" para "Cuota de afiliación", y "otros" para cualquier otro caso.
          - **Meses/Años**: Los períodos a los que corresponde el pago.
          - **Monto por lote (montoLote)**: Si se especifica un monto directamente asociado a un lote (ej. "Lote 24 $25", "Lote 25 20$") dentro de la descripción, extrae este monto. Si la descripción indica múltiples lotes con sus respectivos montos, debes generar un objeto JSON por cada lote con su monto. Si el monto no está especificado para un lote, omite esta propiedad o déjala nula.

          **Ejemplo 1 de Descripción**: "Alicuota de Mantenimiento mes de Enero/Febrero de 2025 Lote 24 $50 y Lote 25 $80"
          **Ejemplo 1 de Salida esperada para el ejemplo anterior**:
          [
            {
              "lote": 24,
              "tipo": "alicuota",
              "fechas": [
                { "month": 1, "year": 2025 },
                { "month": 2, "year": 2025 }
              ],
              "montoLote": 50
            },
            {
              "lote": 25,
              "tipo": "alicuota",
              "fechas": [
                { "month": 1, "year": 2025 },
                { "month": 2, "year": 2025 }
              ],
              "montoLote": 80
            }
          ]

          **Ejemplo 2 de Descripción**: "Alicuota de mantenimiento Enero/Febrero 2025 Lote 25" (aquí no hay monto explícito por lote)
          **Ejemplo 2 de Salida esperada para el ejemplo anterior**:
          [
            {
              "lote": 25,
              "tipo": "alicuota",
              "fechas": [
                { "month": 1, "year": 2025 },
                { "month": 2, "year": 2025 }
              ]
            }
          ]

          **Ejemplo 3 de Descripción**: "Alicuota de mantenimiento Enero/Febrero 2025 Lote 25-26" (aquí no hay monto explícito por lote)
          **Ejemplo 3 de Salida esperada para el ejemplo anterior**:
          [
            {
              "lote": 25,
              "tipo": "alicuota",
              "fechas": [
                { "month": 1, "year": 2025 },
                { "month": 2, "year": 2025 }
              ]
            },
            {
              "lote": 26,
              "tipo": "alicuota",
              "fechas": [
                { "month": 1, "year": 2025 },
                { "month": 2, "year": 2025 }
              ]
            }
          ]

          Descripción: "${doc.descripcion}", NombreComercial: "${doc.persona.nombre_comercial}"`;

          // Definición del esquema de respuesta esperado
          const responseSchema: Schema = {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                lote: { type: Type.NUMBER, nullable: true },
                tipo: {
                  type: Type.STRING,
                  enum: ['alicuota', 'anulacion', 'afiliacion', 'otros'],
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
                  nullable: true,
                },
                montoLote: { type: Type.NUMBER, nullable: true }, // ¡NUEVO! Monto específico por lote
              },
              propertyOrdering: ['lote', 'tipo', 'fechas', 'montoLote'], // Actualiza el orden
              required: ['tipo'],
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
              !['alicuota', 'anulacion', 'afiliacion', 'otros'].includes(
                item.tipo,
              )
            ) {
              throw new Error(`Tipo de pago inválido de Gemini: ${item.tipo}`);
            }

            // Validación de 'lote' y 'fechas' para 'alicuota'
            if (item.tipo === 'alicuota') {
              if (
                typeof item.lote !== 'number' ||
                !Array.isArray(item.fechas) ||
                item.fechas.length === 0 ||
                item.fechas.some(
                  (f) =>
                    typeof f.month !== 'number' || typeof f.year !== 'number',
                )
              ) {
                throw new Error(
                  `Formato de análisis de Gemini inválido para tipo ${item.tipo}: Lote o fechas faltantes/inválidas.`,
                );
              }
            }
          }
        } catch (geminiErr) {
          console.warn(
            `Error al analizar la descripción con Gemini para el documento ${doc.id}:`,
            geminiErr.message ||
              (geminiErr as any).response?.data ||
              JSON.stringify(geminiErr),
          );
          stats.skipped.geminiError++;
          // Registrar el error específico de Gemini
          logContificoError(
            doc.id,
            `Error de análisis con Gemini: ${geminiErr.message || JSON.stringify(geminiErr)}`,
            batch,
            doc.url_ride,
          );
          continue; // Salta al siguiente documento si Gemini falla
        }

        console.log(
          `[${ecuadorDateString}] Análisis Gemini para ${doc.id}:`,
          geminiAnalysisResult,
        ); // 2. Buscar el contactID usando la cédula

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
            `[${ecuadorDateString}] Contacto con cédula ${doc.persona.cedula} no encontrado para el documento ${doc.id}.`,
          ); // Si no hay contacto, se salta este documento de Contifico.
          stats.skipped.noContact++;
          logContificoError(
            doc.id,
            `Contacto no encontrado con cédula: ${doc.persona.cedula}`,
            batch,
            doc.url_ride,
          );
          continue; // Pasa al siguiente documento de Contifico
        }

        // --- Inicio de la lógica corregida para paymentTotalValue ---
        // Pre-cálculos necesarios si hay alícuotas
        const alicuotaResults = geminiAnalysisResult.filter(
          (res) => res.tipo === 'alicuota' && typeof res.lote === 'number',
        );
        const hasMultipleAlicuotaLotsWithoutAmount =
          alicuotaResults.length > 1 &&
          alicuotaResults.every((res) => typeof res.montoLote !== 'number');

        // Iterar sobre los resultados de Gemini (que es un array)
        for (const analysisResult of geminiAnalysisResult) {
          const currentPaymentType = analysisResult.tipo;
          let unidadRef: DocumentReference | null = null;
          let datesToProcess: Array<{ month: number; year: number }> = [];
          let paymentTotalValue: number;

          if (
            currentPaymentType === 'alicuota' ||
            currentPaymentType === 'anulacion'
          ) {
            if (typeof analysisResult.lote !== 'number') {
              console.warn(
                `[${ecuadorDateString}] Documento ${doc.id}: Lote no encontrado para tipo ${currentPaymentType}. Saltando.`,
              );
              stats.skipped[currentPaymentType]++;
              logContificoError(
                doc.id,
                `Lote no encontrado o inválido para tipo ${currentPaymentType}. Descripción: ${doc.descripcion}`,
                batch,
                doc.url_ride,
              );
              continue;
            }
            const unitSnapshot = await db
              .collection('housingUnits')
              .where('projectID', '==', projectRef)
              .where('unitNumber', '==', analysisResult.lote)
              .limit(1)
              .get();

            if (!unitSnapshot.empty) {
              unidadRef = unitSnapshot.docs[0].ref;
            } else {
              console.warn(
                `[${ecuadorDateString}] Unidad de vivienda con lote ${analysisResult.lote} no encontrada para el documento ${doc.id}.`,
              );
              stats.skipped.noUnit++;
              logContificoError(
                doc.id,
                `Unidad de vivienda no encontrada para el lote: ${analysisResult.lote}`,
                batch,
                doc.url_ride,
              );
              continue;
            }

            datesToProcess = analysisResult.fechas || [];
            if (datesToProcess.length === 0) {
              console.warn(
                `[${ecuadorDateString}] Documento ${doc.id}: Fechas faltantes para tipo ${currentPaymentType}. Saltando.`,
              );
              stats.skipped[currentPaymentType]++;
              logContificoError(
                doc.id,
                `Fechas faltantes para tipo ${currentPaymentType}. Descripción: ${doc.descripcion}`,
                batch,
                doc.url_ride,
              );
              continue;
            }

            const numberOfMonths = datesToProcess.length;

            if (
              typeof analysisResult.montoLote === 'number' &&
              analysisResult.montoLote > 0
            ) {
              // Caso 1: Gemini proporcionó un monto específico para el lote
              paymentTotalValue = analysisResult.montoLote / numberOfMonths;
            } else if (
              currentPaymentType === 'alicuota' &&
              hasMultipleAlicuotaLotsWithoutAmount
            ) {
              // Caso 2: Múltiples lotes de alícuota sin monto explícito, USAR unitLandSize
              if (unidadRef) {
                // Asegurarse de que tenemos la referencia de la unidad
                const unitDoc = await unidadRef.get();
                if (unitDoc.exists) {
                  const unitData = unitDoc.data();
                  if (unitData && typeof unitData.unitLandSize === 'number') {
                    paymentTotalValue = unitData.unitLandSize * 0.36; // Este es el monto por mes
                  } else {
                    // Si unitLandSize no se encuentra o es inválido, dar error y continuar
                    console.warn(
                      `[${ecuadorDateString}] Documento ${doc.id}: unitLandSize no encontrado o inválido para lote ${analysisResult.lote} en un escenario de múltiples alícuotas sin monto. Saltando este pago.`,
                    );
                    logContificoError(
                      doc.id,
                      `unitLandSize no encontrado o inválido para lote ${analysisResult.lote} en escenario de múltiples alícuotas sin monto.`,
                      batch,
                      doc.url_ride,
                    );
                    stats.skipped[currentPaymentType]++; // Registra como omitido
                    continue; // Pasa al siguiente analysisResult
                  }
                } else {
                  console.warn(
                    `[${ecuadorDateString}] Documento ${doc.id}: No se encontró documento de unidad para lote ${analysisResult.lote} al intentar calcular monto por unitLandSize. Saltando este pago.`,
                  );
                  logContificoError(
                    doc.id,
                    `No se encontró documento de unidad para lote ${analysisResult.lote} al intentar calcular monto por unitLandSize.`,
                    batch,
                    doc.url_ride,
                  );
                  stats.skipped[currentPaymentType]++; // Registra como omitido
                  continue; // Pasa al siguiente analysisResult
                }
              } else {
                console.warn(
                  `[${ecuadorDateString}] Documento ${doc.id}: Referencia de unidad nula para lote ${analysisResult.lote} en un escenario de múltiples alícuotas sin monto. Saltando este pago.`,
                );
                logContificoError(
                  doc.id,
                  `Referencia de unidad nula para lote ${analysisResult.lote} en escenario de múltiples alícuotas sin monto.`,
                  batch,
                  doc.url_ride,
                );
                stats.skipped[currentPaymentType]++; // Registra como omitido
                continue; // Pasa al siguiente analysisResult
              }
            } else if (
              currentPaymentType === 'alicuota' &&
              !hasMultipleAlicuotaLotsWithoutAmount &&
              unidadRef
            ) {
              // Caso 3: Un solo lote de alícuota sin monto explícito, dividir doc.total
              paymentTotalValue = parseFloat(doc.total) / numberOfMonths;
            } else {
              // Fallback general para cualquier otro caso inesperado de alícuota/anulación sin monto
              paymentTotalValue = parseFloat(doc.total) / numberOfMonths;
            }
          } else if (
            currentPaymentType === 'afiliacion' ||
            currentPaymentType === 'otros'
          ) {
            if (doc.fecha_emision) {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const [day, month, year] = doc.fecha_emision
                .split('/')
                .map(Number);
              datesToProcess.push({ month: month, year: year });
            } else {
              console.warn(
                `[${ecuadorDateString}] Documento ${doc.id}: Fecha de emisión de Contifico faltante para tipo ${currentPaymentType}. Usando fecha actual.`,
              );
              datesToProcess.push({
                month: new Date().getMonth() + 1,
                year: new Date().getFullYear(),
              });
            }

            if (typeof analysisResult.lote === 'number') {
              const unitSnapshot = await db
                .collection('housingUnits')
                .where('projectID', '==', projectRef)
                .where('unitNumber', '==', analysisResult.lote)
                .limit(1)
                .get();
              if (!unitSnapshot.empty) {
                unidadRef = unitSnapshot.docs[0].ref;
              } else {
                console.warn(
                  `[${ecuadorDateString}] Unidad de vivienda con lote ${analysisResult.lote} no encontrada para el documento ${doc.id} (tipo ${currentPaymentType}).`,
                );
              }
            }
            // Para afiliación y otros, el totalValue es simplemente el total del documento de Contifico
            paymentTotalValue = parseFloat(doc.total);
          } else {
            // Este else if es para cubrir casos donde el tipo es inválido, aunque ya se validó antes.
            // En un mundo ideal, no debería llegarse aquí si las validaciones previas son robustas.
            // Pero es una salvaguarda.
            console.warn(
              `[${ecuadorDateString}] Tipo de pago desconocido o no manejado: ${currentPaymentType}. Usando doc.total como valor.`,
            );
            paymentTotalValue = parseFloat(doc.total);
          }

          // Si por alguna razón no tenemos fechas para procesar, saltamos este analysisResult
          if (datesToProcess.length === 0) {
            console.warn(
              `[${ecuadorDateString}] Documento ${doc.id}: No se pudieron determinar fechas para tipo ${currentPaymentType}. Saltando.`,
            );
            stats.skipped[currentPaymentType]++;
            logContificoError(
              doc.id,
              `No se pudieron determinar fechas para tipo ${currentPaymentType}. Descripción: ${doc.descripcion}`,
              batch,
              doc.url_ride,
            );
            continue;
          }

          // !--- Calcular sumatoriaMontoPagos antes del bucle de fechas (se mantiene igual) ---!
          let sumatoriaMontoPagos = 0;
          if (doc.cobros && doc.cobros.length > 0) {
            sumatoriaMontoPagos = doc.cobros.reduce(
              (sum, cobro) => sum + parseFloat(cobro.monto),
              0,
            );
          }

          // !--- Calcular realDateTimestamp antes del bucle de fechas (se mantiene igual) ---!
          let realDateTimestamp: Timestamp | null = null;
          if (doc.estado === 'C' && doc.cobros && doc.cobros.length > 0) {
            const lastCobroDateStr = doc.cobros[doc.cobros.length - 1].fecha;
            const parts = lastCobroDateStr.split('/').map(Number); // Asume DD/MM/YYYY
            if (parts.length === 3) {
              realDateTimestamp = Timestamp.fromDate(
                new Date(Date.UTC(parts[2], parts[1] - 1, parts[0])),
              );
            } else {
              console.warn(
                `[${ecuadorDateString}] Formato de fecha de cobro inesperado para doc ${doc.id}: ${lastCobroDateStr}. No se pudo parsear realDate.`,
              );
              logContificoError(
                doc.id,
                `Formato de fecha de cobro inesperado: ${lastCobroDateStr}`,
                batch,
                doc.url_ride,
              );
            }
          }

          // Crear un payment por cada mes/año devuelto por Gemini para este lote (se mantiene igual, usa paymentTotalValue)
          for (const fecha of datesToProcess) {
            let planMonth = fecha.month;
            let planYear = fecha.year;

            // Ajuste para el siguiente mes si es un pago mensual
            // (Esta lógica de `planMonth++` puede necesitar revisión si la intención es que el `planDate` sea el mes *cobrado*,
            // no el mes *siguiente* al cobrado. Confirmemos esto.)
            planMonth++;
            if (planMonth > 12) {
              planMonth = 1;
              planYear++;
            }

            const basePaymentData = {
              contactID: contactRef,
              projectID: projectRef,
              unidadID: unidadRef,
              planDate: Timestamp.fromDate(
                new Date(Date.UTC(planYear, planMonth - 1, 1)),
              ),
              realDate: realDateTimestamp,
              isPaid: doc.estado === 'C',
              totalValue: paymentTotalValue, // ¡USA EL VALOR CALCULADO POR LOTE/MES!
              paymentValue:
                doc.cobros && doc.cobros.length > 0
                  ? parseFloat(doc.cobros[doc.cobros.length - 1].monto)
                  : 0.0,
              balance: paymentTotalValue - sumatoriaMontoPagos, // Ajusta el balance también
              paymentMethod:
                doc.cobros && doc.cobros.length > 0
                  ? doc.cobros[doc.cobros.length - 1].forma_cobro
                  : null,
              paymentNumber: doc.cobros ? doc.cobros.length : 0,
              lastFollowStatus: doc.estado,
              paymentSupportPdf: doc.url_ride || null,
              paymentName: doc.descripcion,
              paymentSupportImg: null,
              landID: null,
              msgSendPrev: false,
              msgSendCob: false,
              msgSendCom1: false,
              msgSendCom2: false,
              msgSendCom3: false,
              msgSendPrePay: false,
              paymentSupport: [],
              registerDate: Timestamp.fromDate(
                new Date(
                  Date.UTC(
                    new Date().getFullYear(),
                    new Date().getMonth(),
                    new Date().getDate(),
                  ),
                ),
              ),
              month: fecha.month,
              year: fecha.year,
              docRelationated: true,
              idDocContifico: doc.id,
              docFactura: doc.documento,
              anulado: false,
              yearMonth: `${fecha.year}${String(fecha.month).padStart(2, '0')}`,
              cedula: doc.persona.cedula,
            };

            if (analysisResult.tipo === 'anulacion') {
              console.log(
                `[${ecuadorDateString}] Anulación detectada para lote ${analysisResult.lote}, mes ${fecha.month}, año ${fecha.year}. Buscando pago original...`,
              );

              const originalPaymentSnapshot = await db
                .collection('payments')
                .where('projectID', '==', projectRef)
                .where('unidadID', '==', unidadRef)
                .where('contactID', '==', contactRef)
                .where('month', '==', fecha.month)
                .where('year', '==', fecha.year)
                .where('anulado', '==', false)
                .limit(1)
                .get();

              if (!originalPaymentSnapshot.empty) {
                const originalPaymentRef = originalPaymentSnapshot.docs[0].ref;
                console.log(
                  `Pago original encontrado y marcado como anulado: ${originalPaymentRef.id}`,
                );
                batch.update(originalPaymentRef, {
                  anulado: true,
                  fechaAnulacion: Timestamp.fromDate(new Date()),
                  anuladoPorDocContificoId: doc.id,
                });
                batchCounter++;
                stats.updated.anulacion++;
              } else {
                console.warn(
                  `[${ecuadorDateString}] No se encontró un pago original activo para anular para lote ${analysisResult.lote}, mes ${fecha.month}, año ${fecha.year}.`,
                );
                stats.skipped.anulacion++;
                logContificoError(
                  doc.id,
                  `No se encontró pago original para anular para lote ${analysisResult.lote}, mes ${fecha.month}, año ${fecha.year}.`,
                  batch,
                  doc.url_ride,
                );
              }

              const newAnulationPaymentRef = db.collection('payments').doc();
              batch.set(newAnulationPaymentRef, {
                ...basePaymentData,
                paymentType: 'anulacion',
                anulado: false,
              });
              batchCounter++;
              stats.created.anulacion++;
              console.log(
                `[${ecuadorDateString}] Registro de anulación creado para documento Contifico ${doc.id}.`,
              );
            } else {
              const existingPaymentSnapshot = await db
                .collection('payments')
                .where('idDocContifico', '==', doc.id)
                .where('month', '==', fecha.month)
                .where('year', '==', fecha.year)
                .where('contactID', '==', contactRef)
                .where('paymentType', '==', currentPaymentType)
                .limit(1)
                .get();

              if (!existingPaymentSnapshot.empty) {
                console.log(
                  `[${ecuadorDateString}] Payment para documento Contifico ${doc.id}, mes ${fecha.month}, año ${fecha.year}, tipo ${currentPaymentType} y contacto ${doc.persona.cedula} ya existe. Saltando creación.`,
                );
                stats.skipped[currentPaymentType]++;
                continue;
              }

              const newPaymentRef = db.collection('payments').doc();
              batch.set(newPaymentRef, {
                ...basePaymentData,
                paymentType: currentPaymentType,
              });
              batchCounter++;
              stats.created[currentPaymentType]++;
              console.log(
                `[${ecuadorDateString}] Payment de tipo ${currentPaymentType} creado para documento Contifico ${doc.id}.`,
              );
            }

            // Commit del batch si alcanza el límite para evitar errores.
            if (batchCounter >= 499) {
              console.log(
                `[${ecuadorDateString}] Commit de batch de ${batchCounter} operaciones.`,
              );
              await batch.commit();
              batch = db.batch();
              batchCounter = 0;
            }
          }
        }
      }

      // Commit cualquier operación restante en el batch al final.
      if (batchCounter > 0) {
        console.log(
          `[${ecuadorDateString}] Commit del batch final de ${batchCounter} operaciones.`,
        );
        await batch.commit();
      }

      return stats;
    } catch (error) {
      console.error(
        `[${ecuadorDateString}] Error general en contificoDocuments:`,
        error,
      );
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Actualizar el estado de los payments en Firestore según el estado actual en Contifico.
   * Consulta los payments con la fecha más antigua y actualiza su estado a pagado si es necesario.
   */
  async syncPaymentStatesWithContifico(): Promise<string> {
    const db = getFirestore();
    let batch = db.batch();
    let batchCounter = 0;
    let updatedCount = 0;

    try {
      // 1. Consultar todos los pagos en Firestore que estén pendientes (isPaid == false).
      // Se ordenan por 'yearMonth' para procesar desde el más antiguo.
      console.log(`Consultando todos los pagos pendientes para sincronizar.`);

      const paymentsSnapshot = await db
        .collection('payments')
        .where('isPaid', '==', false)
        .orderBy('yearMonth', 'asc') // Ordena para procesar desde el más antiguo pendiente
        .get();

      const payments = paymentsSnapshot.docs;
      console.log(
        `Se encontraron ${payments.length} pagos pendientes en Firestore para verificar.`,
      );

      // Mapa para almacenar los datos de Contifico para no consultar la misma ID repetidamente
      const contificoDataCache = new Map<string, ContificoApiDocument>();

      // 2. Procesar cada pago
      for (const paymentDoc of payments) {
        const paymentData = paymentDoc.data();
        const idDocContifico = paymentData.idDocContifico as string;
        const currentPaymentNumber = (paymentData.paymentNumber as number) || 0; // Obtener el paymentNumber actual de Firestore

        // Si el documento ya no tiene idDocContifico (ej. fue eliminado o mal migrado), saltar.
        if (!idDocContifico) {
          console.warn(
            `El pago ${paymentDoc.id} no tiene idDocContifico. Saltando.`,
          );
          continue;
        }

        let contificoDoc: ContificoApiDocument;

        // Verificar si ya obtuvimos los datos de este idDocContifico de Contifico
        if (contificoDataCache.has(idDocContifico)) {
          contificoDoc = contificoDataCache.get(idDocContifico);
        } else {
          try {
            // Realizar la solicitud a la API de Contifico para obtener el documento completo
            const response = await axios.get<ContificoApiDocument>(
              `${this.configService.get<string>('CONTIFICO_URI')}/documento/${idDocContifico}`,
              {
                headers: {
                  Authorization:
                    this.configService.get<string>('CONTIFICO_API_KEY'),
                },
              },
            );
            contificoDoc = response.data;
            contificoDataCache.set(idDocContifico, contificoDoc); // Guardar en caché
          } catch (err) {
            console.error(
              `Error al obtener el documento de Contifico para idDocContifico ${idDocContifico} (Payment ID: ${paymentDoc.id}):`,
              err.response?.status || err.message,
            );
            continue;
          }
        }

        // Extraer el estado y los cobros de Contifico
        const contificoEstado = contificoDoc.estado;
        const contificoCobros = contificoDoc.cobros || [];
        const contificoTotalValue = parseFloat(contificoDoc.total);

        // Calcular el monto total cobrado según Contifico
        let totalCobradoEnContifico = 0;
        if (contificoCobros.length > 0) {
          for (const cobro of contificoCobros) {
            totalCobradoEnContifico += parseFloat(cobro.monto);
          }
        }
        // Calcular el balance basado en Contifico
        const calculatedBalanceFromContifico =
          contificoTotalValue - totalCobradoEnContifico;
        const contificoPaymentNumber = contificoCobros.length; // Cantidad de cobros en Contifico

        // 3. Aplicar la lógica de actualización basada en el estado y los cobros de Contifico
        let shouldUpdate = false;
        const updateData: {
          isPaid?: boolean;
          anulado?: boolean;
          paymentMethod?: string | null;
          realDate?: Timestamp | null;
          paymentNumber?: number;
          balance?: number;
          paymentValue?: number;
          lastFollowStatus: string;
        } = {
          lastFollowStatus: contificoEstado,
        };

        // Lógica para actualizar los detalles del pago si `paymentNumber` difiere
        // o si el estado en Contifico es 'C' y el pago no estaba marcado como pagado.
        if (
          contificoEstado === 'C' ||
          currentPaymentNumber !== contificoPaymentNumber
        ) {
          // Siempre que haya una diferencia en el número de cobros O el estado sea 'C',
          // se recalcularán y actualizarán los detalles del cobro.
          shouldUpdate = true;

          let lastPaymentMethod: string | null = null;
          let lastRealDate: Timestamp | null = null;
          let lastPaymentValue: number = 0;

          if (contificoCobros.length > 0) {
            const lastCobro = contificoCobros[contificoCobros.length - 1];

            lastPaymentMethod = lastCobro.forma_cobro;
            const [day, month, year] = lastCobro.fecha.split('/').map(Number);
            lastRealDate = Timestamp.fromDate(new Date(year, month - 1, day));
            lastPaymentValue = parseFloat(lastCobro.monto);
          }

          updateData.paymentMethod = lastPaymentMethod;
          updateData.realDate = lastRealDate;
          updateData.paymentNumber = contificoPaymentNumber; // Actualiza con la cantidad de cobros de Contifico
          updateData.balance = calculatedBalanceFromContifico;
          updateData.paymentValue = lastPaymentValue;

          console.log(
            `Payment ${paymentDoc.id} (Contifico ID: ${idDocContifico}): Detalles de cobro actualizados debido a estado 'C' o cambio en paymentNumber.`,
          );

          // Lógica CONDICIONAL para actualizar `isPaid` a TRUE:
          // Solo se marca como pagado si el balance calculado es 0 (o muy cercano).
          if (calculatedBalanceFromContifico <= 0.01) {
            updateData.isPaid = true;
            console.log(
              `Payment ${paymentDoc.id} (Contifico ID: ${idDocContifico}): Balance cero. Marcado como isPaid: true.`,
            );
          } else {
            // Si el balance no es cero, asegura que isPaid sea false si no se había establecido ya
            // La consulta inicial ya filtra por isPaid == false, pero esto es una doble verificación.
            updateData.isPaid = false;
          }
        }
        // Lógica para ANULACIÓN:
        // Se ejecuta si el estado en Contifico es 'A' y no estaba ya anulado en Firestore.
        else if (contificoEstado === 'A' && paymentData.anulado === false) {
          shouldUpdate = true;
          updateData.anulado = true;
          updateData.isPaid = false; // Un documento anulado no debe estar marcado como pagado
          updateData.paymentMethod = null;
          updateData.realDate = null;
          updateData.paymentNumber = 0;
          updateData.balance = contificoTotalValue; // El balance vuelve a ser el total original
          updateData.paymentValue = 0;
          console.log(
            `Payment ${paymentDoc.id} (Contifico ID: ${idDocContifico}): Estado de Contifico 'A' y Firestore 'anulado: false'. Actualizando a anulado: true, isPaid: false y reseteando detalles de cobro.`,
          );
        }
        // Si no se cumple ninguna de las condiciones anteriores, no se actualiza nada (excepto `lastFollowStatus` si se añade fuera).
        // La consulta inicial ya garantiza que `currentIsPaid` es `false`.

        if (shouldUpdate) {
          batch.update(paymentDoc.ref, updateData);
          updatedCount++;
          batchCounter++;

          if (batchCounter === 499) {
            console.log(`Confirmando batch de ${batchCounter} operaciones.`);
            await batch.commit();
            batch = db.batch();
            batchCounter = 0;
          }
        }
      }

      // Confirmar cualquier operación restante en el batch
      if (batchCounter > 0) {
        console.log(`Confirmando batch final de ${batchCounter} operaciones.`);
        await batch.commit();
      }

      return `Sincronización completa. ${updatedCount} pagos actualizados correctamente.`;
    } catch (error) {
      console.error('Error general en syncPaymentStatesWithContifico:', error);
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async verifyPaidPayments(): Promise<string> {
    const db = getFirestore();
    let batch = db.batch();
    let batchCounter = 0;
    let updatedCount = 0;

    try {
      // 1. Calcular el rango de fechas para la consulta (últimos 60 días hasta hoy)
      const today = new Date();
      // Ajustar a las 00:00:00 del día actual para el rango superior
      today.setHours(0, 0, 0, 0);
      const endDate = Timestamp.fromDate(today);

      const sixtyDaysAgo = new Date();
      sixtyDaysAgo.setDate(today.getDate() - 60);
      // Ajustar a las 00:00:00 del día de hace 60 días para el rango inferior
      sixtyDaysAgo.setHours(0, 0, 0, 0);
      const startDate = Timestamp.fromDate(sixtyDaysAgo);

      console.log(
        `Verificando pagos completados desde ${sixtyDaysAgo.toLocaleDateString()} hasta hoy.`,
      );

      // 2. Consultar pagos en Firestore: isPaid == true y realDate dentro del rango
      const paymentsSnapshot = await db
        .collection('payments')
        .where('isPaid', '==', true)
        .where('realDate', '>=', startDate)
        .where('realDate', '<=', endDate)
        .get();

      const payments = paymentsSnapshot.docs;
      console.log(
        `Se encontraron ${payments.length} pagos marcados como pagados en los últimos 60 días para verificar.`,
      );

      // Mapa para almacenar los datos de Contifico y evitar llamadas repetidas
      const contificoDataCache = new Map<string, ContificoApiDocument>();

      // 3. Procesar cada pago encontrado
      for (const paymentDoc of payments) {
        const paymentData = paymentDoc.data();
        const idDocContifico = paymentData.idDocContifico as string;
        const currentIsPaid = paymentData.isPaid as boolean; // Debería ser 'true' por el filtro
        const currentIsAnulado = paymentData.anulado as boolean; // Estado actual de isAnulado en Firestore

        if (!idDocContifico) {
          console.warn(
            `El pago ${paymentDoc.id} no tiene idDocContifico. Saltando.`,
          );
          continue;
        }

        let contificoDoc: ContificoApiDocument;

        // Obtener datos de Contifico (usando caché)
        if (contificoDataCache.has(idDocContifico)) {
          contificoDoc = contificoDataCache.get(idDocContifico);
        } else {
          try {
            const response = await axios.get<ContificoApiDocument>(
              `${this.configService.get<string>('CONTIFICO_URI')}/documento/${idDocContifico}`,
              {
                headers: {
                  Authorization:
                    this.configService.get<string>('CONTIFICO_API_KEY'),
                },
              },
            );
            contificoDoc = response.data;
            contificoDataCache.set(idDocContifico, contificoDoc);
          } catch (err) {
            console.error(
              `Error al obtener el documento de Contifico para idDocContifico ${idDocContifico} (Payment ID: ${paymentDoc.id}):`,
              err.response?.status || err.message,
            );
            continue;
          }
        }

        const contificoEstado = contificoDoc.estado;
        const contificoTotalValue = parseFloat(contificoDoc.total); // Necesario para resetear balance si se anula
        const contificoCobros = contificoDoc.cobros || []; // Necesario para resetear paymentNumber, value

        // Calcular el monto total cobrado según Contifico para determinar el balance actual real
        let totalCobradoEnContifico = 0;
        if (contificoCobros.length > 0) {
          for (const cobro of contificoCobros) {
            totalCobradoEnContifico += parseFloat(cobro.monto);
          }
        }
        const calculatedBalanceFromContifico =
          contificoTotalValue - totalCobradoEnContifico;

        let shouldUpdate = false;
        const updateData: {
          isPaid?: boolean;
          anulado?: boolean;
          paymentMethod?: string | null;
          realDate?: Timestamp | null;
          paymentNumber?: number;
          balance?: number;
          paymentValue?: number;
          lastFollowStatus: string;
        } = {
          lastFollowStatus: contificoEstado,
        };

        // Lógica de reversión: Si Contifico dice que no está cobrado ('P') o está anulado ('A'),
        // y en Firestore está marcado como pagado.
        if (currentIsPaid === true) {
          // Re-confirmamos, aunque el filtro ya lo garantiza
          if (
            contificoEstado === 'P' &&
            calculatedBalanceFromContifico > 0.01
          ) {
            // Balance NO es cero
            shouldUpdate = true;
            updateData.isPaid = false; // Revertir a no pagado
            console.log(
              `Payment ${paymentDoc.id} (Contifico ID: ${idDocContifico}): Estado de Contifico 'P' y balance NO cero. Revirtiendo a isPaid: false.`,
            );
          } else if (contificoEstado === 'A' && currentIsAnulado === false) {
            shouldUpdate = true;
            updateData.anulado = true;
            updateData.isPaid = false; // Un documento anulado no debe estar pagado
            // Resetear campos de cobro por anulación
            updateData.paymentMethod = null;
            updateData.realDate = null;
            updateData.paymentNumber = 0;
            updateData.balance = contificoTotalValue;
            updateData.paymentValue = 0;
            console.log(
              `Payment ${paymentDoc.id} (Contifico ID: ${idDocContifico}): Estado de Contifico 'A' y Firestore 'anulado: false'. Actualizando a anulado: true, isPaid: false y reseteando detalles de cobro.`,
            );
          }
        }

        if (shouldUpdate) {
          batch.update(paymentDoc.ref, updateData);
          updatedCount++;
          batchCounter++;

          if (batchCounter === 499) {
            console.log(`Confirmando batch de ${batchCounter} operaciones.`);
            await batch.commit();
            batch = db.batch();
            batchCounter = 0;
          }
        }
      }

      // Confirmar cualquier operación restante en el batch
      if (batchCounter > 0) {
        console.log(`Confirmando batch final de ${batchCounter} operaciones.`);
        await batch.commit();
      }

      return `Verificación de pagos completados terminada. ${updatedCount} pagos actualizados.`;
    } catch (error) {
      console.error('Error general en verifyPaidPayments:', error);
      throw new HttpException(
        error.message || 'Error interno del servidor',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async runHistoricalContificoImport(): Promise<string> {
    const startDate = new Date('2023-01-01T00:00:00-05:00'); // 1 de enero de 2023, 00:00:00 en la zona horaria de Ecuador (GMT-5)
    const today = new Date(); // Fecha actual

    const currentDate = startDate;
    const overallStats: ContificoProcessingStats = {
      // Estadísticas acumuladas
      created: { alicuota: 0, anulacion: 0, afiliacion: 0, otros: 0 },
      skipped: {
        alicuota: 0,
        anulacion: 0,
        afiliacion: 0,
        otros: 0,
        noUnit: 0,
        noContact: 0,
        geminiError: 0,
        contificoApiError: 0,
      },
      updated: { anulacion: 0 },
      totalContificoDocsProcessed: 0,
    };
    let totalDaysProcessed = 0;

    console.log(
      `Iniciando barrido histórico de Contifico desde ${startDate.toLocaleDateString('es-EC', { timeZone: 'America/Guayaquil' })} hasta hoy.`,
    );

    while (currentDate <= today) {
      const ecuadorDateString = currentDate.toLocaleDateString('en-GB', {
        timeZone: 'America/Guayaquil',
      });

      console.log(`Procesando fecha: ${ecuadorDateString}`);
      try {
        const dailyStats = await this.contificoDocuments(ecuadorDateString); // Ahora devuelve estadísticas

        // Sumar las estadísticas diarias a las generales
        overallStats.created.alicuota += dailyStats.created.alicuota;
        overallStats.created.anulacion += dailyStats.created.anulacion;
        overallStats.created.afiliacion += dailyStats.created.afiliacion;
        overallStats.created.otros += dailyStats.created.otros;

        overallStats.skipped.alicuota += dailyStats.skipped.alicuota;
        overallStats.skipped.anulacion += dailyStats.skipped.anulacion;
        overallStats.skipped.afiliacion += dailyStats.skipped.afiliacion;
        overallStats.skipped.otros += dailyStats.skipped.otros;
        overallStats.skipped.noContact += dailyStats.skipped.noContact;
        overallStats.skipped.noUnit += dailyStats.skipped.noUnit;
        overallStats.skipped.geminiError += dailyStats.skipped.geminiError;
        overallStats.skipped.contificoApiError +=
          dailyStats.skipped.contificoApiError;

        overallStats.updated.anulacion += dailyStats.updated.anulacion;
        overallStats.totalContificoDocsProcessed +=
          dailyStats.totalContificoDocsProcessed;

        totalDaysProcessed++;
        console.log(`Estadísticas del día ${ecuadorDateString}:`, dailyStats);
      } catch (error) {
        console.error(`Error al procesar el día ${ecuadorDateString}:`, error);
        // El error ya fue manejado y logeado dentro de contificoDocuments,
        // pero lo registramos aquí si llega a este catch superior.
      }

      currentDate.setDate(currentDate.getDate() + 1);
    }

    console.log(`--- Barrido histórico completo ---`);
    console.log(`Días procesados: ${totalDaysProcessed}`);
    console.log(`Estadísticas generales:`, overallStats);

    return `Barrido histórico completo. Días procesados: ${totalDaysProcessed}. Total de documentos Contifico manejados: ${overallStats.totalContificoDocsProcessed}. Pagos creados: ${overallStats.created.alicuota} alícuotas, ${overallStats.created.anulacion} anulaciones, ${overallStats.created.afiliacion} afiliaciones, ${overallStats.created.otros} otros. Pagos actualizados (anulados): ${overallStats.updated.anulacion}. Pagos saltados: ${overallStats.skipped.alicuota} alícuotas, ${overallStats.skipped.anulacion} anulaciones, ${overallStats.skipped.afiliacion} afiliaciones, ${overallStats.skipped.otros} otros, ${overallStats.skipped.noUnit} por falta de unidad, ${overallStats.skipped.noContact} por falta de contacto, ${overallStats.skipped.geminiError} por error de Gemini, ${overallStats.skipped.contificoApiError} por error de Contifico API.`;
  }
}
