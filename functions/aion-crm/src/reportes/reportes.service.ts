import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { Request } from 'express';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { PDFDocument, rgb, PageSizes, PDFImage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { DateTime } from 'luxon';
import * as fs from 'fs';
import axios from 'axios';

@Injectable()
export class ReportesService {
  private db = getFirestore();
  private storage = getStorage().bucket('aion-crm-asm.appspot.com');

  // First function: reportePDFContactFailed
  async reportePDFContactFailed(req: Request): Promise<string[]> {
    const { source, lastLeadStatus, logoUrl } = req.body;

    if (!Array.isArray(lastLeadStatus) || lastLeadStatus.length === 0) {
      throw new HttpException(
        'No se proporcionaron datos lastLeadStatus',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!Array.isArray(source) || source.length === 0) {
      throw new HttpException(
        'No se proporcionaron datos source',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!logoUrl) {
      throw new HttpException(
        'No se proporcionó el logoUrl',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const leadsContactFailData = [];
      let limitReached = false;

      const timeZone = 'America/Guayaquil';

      const getNextDayOfWeek = (dayOfWeek: number): DateTime => {
        const now = DateTime.now()
          .setZone(timeZone)
          .set({ hour: 0, minute: 0, second: 0, millisecond: 0 });
        let daysToAdd = dayOfWeek - now.weekday;

        if (daysToAdd <= 0) {
          daysToAdd += 7;
        }

        return now.plus({ days: daysToAdd });
      };

      const dates = [
        getNextDayOfWeek(5), // Viernes
        getNextDayOfWeek(6), // Sábado
        getNextDayOfWeek(7), // Domingo
        getNextDayOfWeek(1), // Lunes
      ];

      for (const src of source) {
        if (limitReached) break;

        for (const statusId of lastLeadStatus) {
          if (limitReached) break;

          const querySnapshot = await this.db
            .collection('contactos')
            .where('source', '==', src)
            .where('lastLeadStatus', '==', statusId)
            .limit(400 - leadsContactFailData.length)
            .get();

          const leads = querySnapshot.docs.map((leadContact) => ({
            docReference: leadContact.ref,
            data: leadContact.data(),
          }));
          leadsContactFailData.push(...leads);

          if (leadsContactFailData.length >= 400) {
            limitReached = true;
            break;
          }
        }
      }

      if (leadsContactFailData.length < 1) {
        throw new HttpException(
          'No se encontraron documentos para los filtros especificados.',
          HttpStatus.NOT_FOUND,
        );
      }

      const groupedResults = [];
      while (leadsContactFailData.length > 0) {
        groupedResults.push(leadsContactFailData.splice(0, 100));
      }

      const pdfDocIds = [];

      for (const [index, group] of groupedResults.entries()) {
        const resultados = group.map(
          (row: {
            data: {
              source: any;
              registrationDate: any;
              names: any;
              surenames: any;
              email: any;
              phone: any;
              lastUpdate: any;
              lastLeadStatus: any;
              notes: any;
            };
          }) => ({
            origen: row.data.source || '',
            fecha: row.data.registrationDate
              ? this.formatDate(row.data.registrationDate)
              : '',
            nombre: row.data.names ? row.data.names : '',
            apellido: row.data.surenames ? row.data.surenames : '',
            correo: row.data.email ? row.data.email : '',
            telefono: row.data.phone ? row.data.phone : '',
            ultimoSeguimiento: row.data.lastUpdate
              ? this.formatDate(row.data.lastUpdate) || ''
              : '',
            status: row.data.lastLeadStatus ? row.data.lastLeadStatus : '',
            comentario: row.data.notes ? row.data.notes : '',
          }),
        );

        const pdfBytes = await this.generatePDF('contact-failed', resultados, {
          logoUrl,
        });

        const pdfDate = dates[index % 4];
        const formattedDate = pdfDate.toFormat('dd-MM-yyyy');

        const destination = `pdfs/will-contact/seguimiento_${source}_${formattedDate}.pdf`;

        const file = this.storage.file(destination);
        await file
          .save(pdfBytes, {
            metadata: {
              contentType: 'application/pdf',
              cacheControl: 'public, max-age=31536000',
            },
          })
          .then(async () => {
            console.log('Éxito al guardar pdf en Firebase Storage.');
            await file.makePublic();
          })
          .catch((err) => {
            const errorMsg = 'Error al guardar en Firebase Storage el pdf';
            console.error(errorMsg);
            console.error(err);
          });

        console.log(
          `El PDF grupo ${index + 1} ha sido subido a ${destination}`,
        );

        const url = file.publicUrl();

        const docRef = await this.db.collection('pdfSeguimientos').add({
          url: url,
          fecha: pdfDate.toJSDate(),
          contactos: group.map(
            (row: { docReference: any }) => row.docReference,
          ),
        });

        pdfDocIds.push(docRef.id);
      }

      return pdfDocIds;
    } catch (error) {
      console.error('Error generando el PDF:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error interno del servidor al generar el PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Second function: reportePDFCotTerreno
  async reportePDFCotTerreno(req: Request): Promise<string> {
    const { clienteId, landsQuoteId, planoUrl, logoUrl } = req.body;

    if (!clienteId || !landsQuoteId || !planoUrl || !logoUrl) {
      throw new HttpException(
        'No se proporcionaron alguno de los siguientes parámetros: clienteId, landsQuoteId, planoUrl y/o logoUrl',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const clientRef = this.db.collection('contactos').doc(clienteId);
      const clientData = (await clientRef.get()).data();

      const cotizacionData = (
        await this.db.collection('landsQuote').doc(landsQuoteId).get()
      ).data();

      const resultados = {
        cliente: `${clientData.title || ''} ${clientData.name}`,
        email: `${cotizacionData.email || ''}`,
        cedula: `${cotizacionData.idNumber || ''}`,
        solar: `${cotizacionData.solar || ''}`,
        area: `${
          cotizacionData.landAreaM2
            ? cotizacionData.landAreaM2.toFixed(2) + 'M2'
            : ''
        }`,
        precio: `${
          cotizacionData.price
            ? cotizacionData.price.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
              })
            : ''
        }`,
        reserva: `${
          cotizacionData.booking
            ? cotizacionData.booking.toLocaleString('en-US', {
                style: 'currency',
                currency: 'USD',
              })
            : ''
        }`,
        entrada: {
          value1: `${
            cotizacionData.entrancePercentage
              ? Math.round(cotizacionData.entrancePercentage) + '%'
              : ''
          }`,
          value2: `${
            cotizacionData.entranceBooking
              ? cotizacionData.entranceBooking.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })
              : ''
          }`,
        },
        firstExpiration: `${
          cotizacionData.firstExpiration
            ? this.formatDate(cotizacionData.firstExpiration, false)
            : ''
        }`,
        saldo: {
          value1: `${
            cotizacionData.bankCreditBalancePercentage
              ? Math.round(cotizacionData.bankCreditBalancePercentage) + '%'
              : ''
          }`,
          value2: `${
            cotizacionData.bankCreditBalanceValue
              ? cotizacionData.bankCreditBalanceValue.toLocaleString('en-US', {
                  style: 'currency',
                  currency: 'USD',
                })
              : ''
          }`,
        },
        cuotasTotales: [],
      };
      for (let i = 0; i < cotizacionData.quotesPlan.length; i++) {
        const quota = cotizacionData.quotesPlan[i];
        const fechaCuota = DateTime.fromJSDate(quota.fecha.toDate()).toFormat(
          'dd/MM/yyyy',
        );

        resultados.cuotasTotales.push({
          numCuota: i + 1,
          valor: quota.valor.toLocaleString('en-US', {
            style: 'currency',
            currency: 'USD',
          }),
          fecha: fechaCuota,
        });
      }

      const pdfBytes = await this.generatePDF(
        'cotizacion-terreno',
        resultados,
        {
          logoUrl,
          planoUrl,
        },
      );

      const destination = `pdfs/cotizaciones/${clientData.name}_${new Date(Date.now())}.pdf`;

      const file = this.storage.file(destination);
      await file
        .save(pdfBytes, {
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'public, max-age=31536000',
          },
        })
        .then(async () => {
          console.log('Éxito al guardar pdf en Firebase Storage.');
          await file.makePublic();
        })
        .catch((err) => {
          const errorMsg = 'Error al guardar en Firebase Storage el pdf';
          console.error(errorMsg);
          console.error(err);
        });

      console.log(`El PDF ha sido subido a ${destination}`);

      await this.db.collection('landsQuote').doc(landsQuoteId).update({
        registrationDate: FieldValue.serverTimestamp(),
        landQuoteUrl: file.baseUrl,
      });

      const url = file.publicUrl();

      return url;
    } catch (error) {
      console.error('Error generando el PDF:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error interno del servidor al generar el PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Third function: reportePDFLeadStatus
  async reportePDFLeadStatus(req: Request): Promise<string> {
    const { startDate, finalDate, logoUrl } = req.body;

    if (!startDate || !finalDate || !logoUrl) {
      throw new HttpException(
        'No se proporcionaron alguno de estos parámetros: startDate, finalDate y/o logoUrl',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const start = new Date(startDate);
      const end = new Date(finalDate);
      const fechaStartPDF = new Date(startDate);
      const fechaEndPDF = new Date(finalDate);

      const leadFollowUpsData = (
        await this.db
          .collection('leadFollowUps')
          .where('followUpDate', '>=', start)
          .where('followUpDate', '<=', end)
          .where('status', '!=', null)
          .get()
      ).docs.map((leadFollow) => leadFollow.data());

      if (leadFollowUpsData.length < 1) {
        throw new HttpException(
          'No se encontraron documentos en el rango de fechas especificado.',
          HttpStatus.NOT_FOUND,
        );
      }

      const formattedStart = this.formatDate(start, true);
      const formattedEnd = this.formatDate(end, true);

      const resultadosMap = {};
      let totalLeads = 0;

      leadFollowUpsData.forEach((lead) => {
        const estado = lead.status;
        totalLeads++;

        if (resultadosMap[estado]) {
          resultadosMap[estado].cantidadDeLeads += 1;
        } else {
          resultadosMap[estado] = {
            estado: estado,
            cantidadDeLeads: 1,
            porcentaje: 0,
          };
        }
      });

      const resultados = Object.values(resultadosMap).map((item: any) => {
        item.porcentaje = `${((item.cantidadDeLeads / totalLeads) * 100).toFixed(1)}%`;
        return item;
      });

      const pdfBytes = await this.generatePDF('lead-status', resultados, {
        logoUrl,
        fechaInicio: formattedStart,
        fechaFin: formattedEnd,
      });

      const destination = `pdfs/leads/inicio_${
        fechaStartPDF.getDate() +
        '_' +
        (fechaStartPDF.getMonth() + 1) +
        '_' +
        fechaStartPDF.getFullYear()
      }_final_${
        fechaEndPDF.getDate() +
        '_' +
        (fechaEndPDF.getMonth() + 1) +
        '_' +
        fechaEndPDF.getFullYear()
      }_${new Date(Date.now())}.pdf`;

      const file = this.storage.file(destination);
      await file
        .save(pdfBytes, {
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'public, max-age=31536000',
          },
        })
        .then(async () => {
          await file.makePublic();
        })
        .catch((err) => {
          const errorMsg = 'Error al guardar en Firebase Storage el pdf';
          console.error(errorMsg);
          console.error(err);
        });

      console.log(`El PDF ha sido subido a ${destination}`);

      const url = file.publicUrl();

      return url;
    } catch (error) {
      console.error('Error generando el PDF:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error interno del servidor al generar el PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Fourth function: reportePDFSeguimiento
  async reportePDFSeguimiento(req: Request): Promise<string[]> {
    const {
      source,
      lastLeadStatus,
      logoUrl,
      nombre,
      initDate,
      finalDate,
      maxContacts,
    } = req.body;

    if (!Array.isArray(lastLeadStatus) || lastLeadStatus.length === 0) {
      throw new HttpException(
        'No se proporcionaron datos lastLeadStatus',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!Array.isArray(source) || source.length === 0) {
      throw new HttpException(
        'No se proporcionaron datos source',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!logoUrl) {
      throw new HttpException(
        'No se proporcionó el logoUrl',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!nombre) {
      throw new HttpException(
        'No se proporcionó el nombre',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!maxContacts) {
      throw new HttpException(
        'No se proporcionó la cantidad de contactos',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!initDate) {
      throw new HttpException(
        'No se proporcionó la fecha inicial',
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!finalDate) {
      throw new HttpException(
        'No se proporcionó la fecha final',
        HttpStatus.BAD_REQUEST,
      );
    }

    // Convertimos la fecha a medianoche (12:00 AM) independientemente de la zona horaria.
    const dateInit = DateTime.fromFormat(initDate, 'yyyy-MM-dd HH:mm:ss.SSS', {
      zone: 'utc',
    }).set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    const dateFinal = DateTime.fromFormat(
      finalDate,
      'yyyy-MM-dd HH:mm:ss.SSS',
      { zone: 'utc' },
    ).set({ hour: 0, minute: 0, second: 0, millisecond: 0 });

    try {
      const leadsContactFailData = [];
      let limitReached = false;

      for (const statusId of lastLeadStatus) {
        if (limitReached) break;

        for (const src of source) {
          if (limitReached) break;

          const querySnapshot = await this.db
            .collection('contactos')
            .where('lastLeadStatus', '==', statusId)
            .where('source', '==', src)
            .where('nextActivity', '>=', dateInit.toJSDate())
            .where('nextActivity', '<=', dateFinal.toJSDate())
            .limit(maxContacts - leadsContactFailData.length)
            .get();

          const leads = querySnapshot.docs.map((leadContact) => ({
            docReference: leadContact.ref,
            data: leadContact.data(),
          }));
          leadsContactFailData.push(...leads);

          if (leadsContactFailData.length >= maxContacts) {
            limitReached = true;
            break;
          }
        }
      }

      if (leadsContactFailData.length < 1) {
        throw new HttpException(
          'No se encontraron contactos para los filtros especificados.',
          HttpStatus.NOT_FOUND,
        );
      }

      const pdfDocIds = [];

      let count = 1;

      const resultados = leadsContactFailData.map((row) => ({
        contador: count++,
        origen: row.data.source || '',
        nombre: row.data.names ? row.data.names : '',
        apellido: row.data.surenames ? row.data.surenames : '',
        correo: row.data.email ? row.data.email : '',
        telefono: row.data.phone ? row.data.phone : '',
      }));

      const pdfBytes = await this.generatePDF('seguimiento', resultados, {
        logoUrl,
        nombre,
      });

      const formattedInitDate = dateInit.toFormat('dd-MM-yyyy');
      const formattedFinalDate = dateFinal.toFormat('dd-MM-yyyy');

      const destination = `pdfs/seguimiento/${nombre}_${formattedInitDate}_${formattedFinalDate}.pdf`;

      const file = this.storage.file(destination);
      await file
        .save(pdfBytes, {
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'public, max-age=31536000',
          },
        })
        .then(async () => {
          console.log('Éxito al guardar pdf en Firebase Storage.');
          await file.makePublic();
        })
        .catch((err) => {
          const errorMsg = 'Error al guardar en Firebase Storage el pdf';
          console.error(errorMsg);
          console.error(err);
        });

      console.log(`El seguimiento PDF ha sido subido a ${destination}`);

      const url = file.publicUrl();

      const docRef = await this.db.collection('pdfSeguimientos').add({
        url: url,
        fechaInicio: dateInit.toJSDate(),
        fechaFin: dateFinal.toJSDate(),
        contactos: leadsContactFailData.map((row) => row.docReference),
        name: nombre,
      });

      pdfDocIds.push(docRef.id);

      return pdfDocIds;
    } catch (error) {
      console.error('Error generando el PDF:', error);

      if (error instanceof HttpException) {
        throw error;
      }

      throw new HttpException(
        'Error interno del servidor al generar el PDF',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  // Utility methods

  private formatDate(date: any, JS?: boolean): string {
    let newDate: Date;

    if (JS) {
      newDate = date;
    } else if (date.toDate) {
      newDate = date.toDate();
    } else {
      newDate = new Date(date);
    }

    const day = newDate.getDate().toString().padStart(2, '0');
    const month = (newDate.getMonth() + 1).toString().padStart(2, '0');
    const year = newDate.getFullYear();

    return `${day}/${month}/${year}`;
  }

  private async generatePDF(
    type: string,
    data: any,
    options: any,
  ): Promise<Uint8Array> {
    const pdfDoc = await PDFDocument.create();
    pdfDoc.registerFontkit(fontkit);

    const fontBytesRegular = fs.readFileSync(
      './fonts/montserrat 2/Montserrat-Regular.otf',
    );
    const fontBytesBold = fs.readFileSync(
      './fonts/montserrat 2/Montserrat-Bold.otf',
    );

    const font = await pdfDoc.embedFont(fontBytesRegular);
    const fontBold = await pdfDoc.embedFont(fontBytesBold);

    let logoImage: PDFImage;
    try {
      const logoResponse = await axios.get(options.logoUrl, {
        responseType: 'arraybuffer',
      });
      const logoBytes = logoResponse.data;
      logoImage = await pdfDoc.embedPng(logoBytes);
    } catch (error) {
      console.log(error);
      throw new HttpException(
        'Error al obtener la imagen del logo',
        HttpStatus.BAD_REQUEST,
      );
    }

    switch (type) {
      case 'contact-failed':
        // Implement the PDF generation logic for 'contact-failed' type
        return await this.generateContactFailedPDF(
          pdfDoc,
          data,
          logoImage,
          font,
          fontBold,
        );
      case 'cotizacion-terreno':
        // Implement the PDF generation logic for 'cotizacion-terreno' type
        return await this.generateCotizacionTerrenoPDF(
          pdfDoc,
          data,
          options,
          logoImage,
          font,
          fontBold,
        );
      case 'lead-status':
        // Implement the PDF generation logic for 'lead-status' type
        return await this.generateLeadStatusPDF(
          pdfDoc,
          data,
          options,
          logoImage,
          font,
          fontBold,
        );
      case 'seguimiento':
        // Implement the PDF generation logic for 'seguimiento' type
        return await this.generateSeguimientoPDF(
          pdfDoc,
          data,
          options,
          logoImage,
          font,
          fontBold,
        );
      default:
        throw new HttpException(
          'Tipo de PDF no soportado',
          HttpStatus.BAD_REQUEST,
        );
    }
  }

  private splitTextIntoLines(
    text: any,
    maxWidth: number,
    fontSize: number,
    font: any,
  ): string[] {
    text = String(text || '');
    const words = text.split(' ');
    const lines = [];
    let currentLine = '';

    words.forEach((word) => {
      const testLine = currentLine ? currentLine + ' ' + word : word;
      const testWidth = font.widthOfTextAtSize(testLine, fontSize);

      if (testWidth <= maxWidth) {
        currentLine = testLine;
      } else {
        lines.push(currentLine);
        currentLine = word;
      }
    });

    if (currentLine) {
      lines.push(currentLine);
    }

    return lines;
  }

  private drawFooter(
    currentPage: any,
    font: any,
    footerSize: number,
    width: number,
  ): void {
    const footerText = `CC. Río Plaza Piso 1 - Oficina 1 - Km 1 Vía a Samborondón\nSamborondón\nCelular Oficina Matriz: 0968265924`;

    const footerLines = footerText.trim().split('\n');
    let footerYPosition = 50;

    footerLines.forEach((line) => {
      const textWidth = font.widthOfTextAtSize(line.trim(), footerSize);
      const xPosition = (width - textWidth) / 2;
      currentPage.drawText(line.trim(), {
        x: xPosition,
        y: footerYPosition,
        size: footerSize,
        font: font,
        color: rgb(0, 0, 0),
      });
      footerYPosition -= footerSize + 2;
    });
  }

  // Implement the specific PDF generation methods for each type
  // For brevity, these methods are not fully implemented here
  private async generateContactFailedPDF(
    pdfDoc: PDFDocument,
    data: any,
    logoImage: any,
    font: any,
    fontBold: any,
  ): Promise<Uint8Array> {
    // Crear un nuevo documento PDF tamaño carta
    let page = pdfDoc.addPage([1280, 792]);
    const { width, height } = page.getSize();

    // eslint-disable-next-line max-len
    // Cargar la imagen de la captura de pantalla (la imagen debe estar en una URL accesible públicamente)
    const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

    const fontSize = 8;
    const footerFontSize = 8;
    const footerMargin = 10;
    const rowHeight = 20;

    // Dibujar el logo
    page.drawImage(logoImage, {
      x: 35,
      y: height - logoDims.height - 20,
      width: logoDims.width,
      height: logoDims.height,
    });

    // Establecer las fuentes
    pdfDoc.registerFontkit(fontkit);

    // Título
    // Título: "REPORTE DE LEADS"
    page.drawText('REPORTE DE PROSPECTOS', {
      x: 35,
      y: height - 130,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0.129, 0.302),
    });

    // Tabla de datos
    const tableTop = height - 160;
    const tableLeft = 35;
    let yPosition = tableTop;

    const headers = [
      { label: 'Origen', key: 'origen' },
      { label: 'Fecha', key: 'fecha' },
      { label: 'Nombre', key: 'nombre' },
      { label: 'Apellido', key: 'apellido' },
      { label: 'Correo', key: 'email' },
      { label: 'Teléfono', key: 'telefono' },
      { label: 'Último Seguimiento', key: 'ultimoSeguimiento' },
      { label: 'Estado', key: 'status' },
      { label: 'Comentario', key: 'comentario' },
    ];
    const columnWidths = [90, 66, 100, 100, 150, 66, 100, 180, 340];

    headers.forEach((header, i) => {
      const xPosition =
        tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

      page.drawRectangle({
        x: xPosition,
        y: yPosition - rowHeight,
        width: columnWidths[i],
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      page.drawText(header.label, {
        x: xPosition + 5,
        y: yPosition - fontSize - 5,
        size: fontSize,
        font: fontBold,
        color: rgb(0, 0, 0),
      });
    });

    yPosition -= rowHeight;

    // Dibujar filas de datos y bordes
    // Dibujar las filas de datos
    data.forEach((row: { [key: string]: string }) => {
      let maxLines = 1;

      // Calcular el máximo de líneas
      headers.forEach((header, i) => {
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText,
          columnWidths[i] - 10,
          fontSize,
          font,
        );
        maxLines = Math.max(maxLines, lines.length);
      });

      const cellHeight = maxLines * rowHeight;
      const spaceForFooter = footerMargin + 85 + footerFontSize * 4;

      // Verificar si se necesita una nueva página
      if (yPosition - cellHeight < spaceForFooter) {
        page = pdfDoc.addPage([1280, 792]);
        yPosition = height - 50;

        // Redibujar los encabezados
        headers.forEach((header, i) => {
          const xPosition =
            tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

          page.drawRectangle({
            x: xPosition,
            y: yPosition - rowHeight,
            width: columnWidths[i],
            height: rowHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
          });

          page.drawText(header.label, {
            x: xPosition + 5,
            y: yPosition - fontSize - 5,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          });
        });

        yPosition -= rowHeight;
      }

      // Dibujar cada celda
      headers.forEach((header, i) => {
        const xPosition =
          tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

        // Dibujar el rectángulo de la celda
        page.drawRectangle({
          x: xPosition,
          y: yPosition - cellHeight,
          width: columnWidths[i],
          height: cellHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText,
          columnWidths[i] - 10,
          fontSize,
          font,
        );

        // Dibujar el texto
        lines.forEach((line, lineIndex) => {
          const textYPosition =
            yPosition - (lineIndex + 1) * fontSize - 5 - lineIndex * 5;

          page.drawText(line, {
            x: xPosition + 5,
            y: textYPosition,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
        });
      });

      // Ajustar yPosition para la siguiente fila
      yPosition -= cellHeight;
    });

    // Dibujar el pie de página
    pdfDoc.getPages().forEach((p, index) => {
      if (index === pdfDoc.getPageCount() - 1) {
        this.drawFooter(p, font, footerFontSize, width);
      }
    });

    return await pdfDoc.save();
  }

  private async generateCotizacionTerrenoPDF(
    pdfDoc: PDFDocument,
    data: any,
    options: any,
    logoImage: any,
    font: any,
    fontBold: any,
  ): Promise<Uint8Array> {
    let page = pdfDoc.addPage(PageSizes.Letter);
    const { width, height } = page.getSize();

    const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

    const fontSize = 8;
    const footerFontSize = 8;
    const footerMargin = 10;
    const rowHeight = 20;

    const image1Bytes = await fetch(options.planoUrl).then((res) =>
      res.arrayBuffer(),
    );
    const image1Image = await pdfDoc.embedJpg(image1Bytes);
    const image1Dims = image1Image.scale(0.2);

    const marginTop = 50;
    const marginBottom = 50; // Margen inferior para el contenido antes del footer
    const footerHeight = 60; // Altura reservada para el footer

    // Dibujar el logo
    page.drawImage(logoImage, {
      x: width / 3,
      y: height - logoDims.height - 20,
      width: logoDims.width * 2,
      height: logoDims.height > 90 ? logoDims.height : logoDims.height * 1.2,
    });

    // Establecer las fuentes
    pdfDoc.registerFontkit(fontkit);

    // Dibujar la imagen 1 en la página
    page.drawImage(image1Image, {
      x: width / 1.85,
      y: height - image1Dims.height - 200,
      width: image1Dims.width * 1.2,
      height: image1Dims.height * 1.8,
    });

    // Establecer las fuentes para el texto
    pdfDoc.registerFontkit(fontkit);

    // Título
    page.drawText('COTIZACION DE TERRENO', {
      x: 75,
      y: height - 80,
      size: fontSize + 2,
      font: fontBold,
      color: rgb(0.004, 0, 0.329),
    });
    let xFields = 20;
    let yFields = height - 110;

    // Campos de texto
    const fields = [
      { label: 'Cliente:', key: 'cliente' },
      { label: 'Correo:', key: 'email' },
      { label: 'Cédula:', key: 'cedula' },
      { label: 'Solar:', key: 'solar' },
      { label: 'Área de Terreno (M2):', key: 'area' },
      { label: 'Precio:', key: 'precio' },
      { label: 'Reserva:', key: 'reserva' },
      { label: 'ENTRADA - RESERVA:', key: 'entrada' },
      { label: 'Primer Vencimiento:', key: 'firstExpiration' },
      { label: 'Saldo CRÉDITO BANCARIO:', key: 'saldo' },
    ];

    // Define un valor para el espaciado vertical entre campos
    const verticalSpacing = 20; // Puedes ajustar este valor según tus necesidades

    // Dibujar los campos de texto
    fields.forEach((field) => {
      page.drawText(field.label, {
        x: xFields,
        y: yFields,
        size:
          field.label == 'Saldo CRÉDITO BANCARIO:' ? fontSize - 1 : fontSize,
        font: fontBold,
        color: rgb(0, 0, 0),
      });

      if (data[field.key].value2) {
        // Campos con value1 y value2
        const lines1 = this.splitTextIntoLines(
          data[field.key].value1,
          50,
          fontSize,
          font,
        );
        const lines2 = this.splitTextIntoLines(
          data[field.key].value2,
          140,
          fontSize,
          font,
        );
        const maxLines = Math.max(lines1.length, lines2.length, 1);
        const cellHeight = maxLines * (fontSize + 5); // 5 es el espaciado entre líneas

        // Ajusta la coordenada y del rectángulo para alinearlo con la etiqueta
        const rectY = yFields - fontSize + 3; // Ajusta "3" si es necesario

        // Dibuja los rectángulos
        page.drawRectangle({
          x: xFields + 100,
          y: rectY,
          width: 50,
          height: cellHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: xFields + 160,
          y: rectY,
          width: 140,
          height: cellHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        // Calcula la posición y del texto dentro del rectángulo
        const textYPosition1 = rectY + cellHeight - fontSize;

        lines1.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xFields + 110,
            y: textYPosition1 - lineIndex * (fontSize + 5),
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });

        const textYPosition2 = rectY + cellHeight - fontSize;

        lines2.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xFields + 170,
            y: textYPosition2 - lineIndex * (fontSize + 5),
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });

        // Actualiza yFields para el siguiente campo, usando el nuevo espaciado vertical
        yFields = rectY - verticalSpacing;
      } else {
        // Campos con valor simple
        const lines = this.splitTextIntoLines(
          data[field.key],
          200,
          fontSize,
          font,
        );
        const cellHeight = Math.max(lines.length, 1) * (fontSize + 5);

        const rectY = yFields - fontSize + 3;

        page.drawRectangle({
          x: xFields + 100,
          y: rectY,
          width: 200,
          height: cellHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        const textYPosition = rectY + cellHeight - fontSize;

        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xFields + 110,
            y: textYPosition - lineIndex * (fontSize + 5),
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });

        // Actualiza yFields para el siguiente campo, usando el nuevo espaciado vertical
        yFields = rectY - verticalSpacing;
      }

      // Verificar si se necesita una nueva página
      if (yFields - rowHeight < footerFontSize + footerMargin) {
        page = pdfDoc.addPage(PageSizes.Letter);
        yFields = height - 50;
      }
    });

    // Después de dibujar los campos, comenzamos con las cuotas
    page.drawText('Cuotas:', {
      x: xFields,
      y: yFields,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    yFields -= 20; // Mover hacia abajo antes de dibujar los encabezados

    // Dibujar los encabezados de la tabla
    page.drawRectangle({
      x: xFields + 90,
      y: yFields - 5,
      width: 40,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawRectangle({
      x: xFields + 130,
      y: yFields - 5,
      width: 90,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawRectangle({
      x: xFields + 220,
      y: yFields - 5,
      width: 80,
      height: rowHeight,
      borderColor: rgb(0.635, 0.635, 0.635),
      borderWidth: 1,
    });

    page.drawText('#', {
      x: xFields + 95,
      y: yFields,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    page.drawText('Fecha', {
      x: xFields + 135,
      y: yFields,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    page.drawText('Monto', {
      x: xFields + 225,
      y: yFields,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    yFields -= rowHeight; // Ajustar yFields para las filas de datos

    data.cuotasTotales.forEach(
      (cuota: { numCuota: any; fecha: string; valor: string }) => {
        if (yFields - rowHeight < footerHeight + marginBottom) {
          page = pdfDoc.addPage(PageSizes.Letter);
          yFields = height - marginTop; // Reiniciar la posición Y
          // Redibujar los encabezados en la nueva página
          page.drawRectangle({
            x: xFields + 90,
            y: yFields - 5,
            width: 50,
            height: rowHeight,
            borderColor: rgb(0.635, 0.635, 0.635),
            borderWidth: 1,
          });

          page.drawRectangle({
            x: xFields + 130,
            y: yFields - 5,
            width: 80,
            height: rowHeight,
            borderColor: rgb(0.635, 0.635, 0.635),
            borderWidth: 1,
          });

          page.drawRectangle({
            x: xFields + 220,
            y: yFields - 5,
            width: 80,
            height: rowHeight,
            borderColor: rgb(0.635, 0.635, 0.635),
            borderWidth: 1,
          });

          page.drawText('Cuota', {
            x: xFields + 95,
            y: yFields,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          });

          page.drawText('Fecha', {
            x: xFields + 135,
            y: yFields,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          });

          page.drawText('Monto', {
            x: xFields + 225,
            y: yFields,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          });

          yFields -= rowHeight; // Ajustar yFields para las filas de datos
        }

        page.drawRectangle({
          x: xFields + 90,
          y: yFields - 5,
          width: 40,
          height: rowHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: xFields + 130,
          y: yFields - 5,
          width: 90,
          height: rowHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: xFields + 220,
          y: yFields - 5,
          width: 80,
          height: rowHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        page.drawText(`${cuota.numCuota}`, {
          x: xFields + 95,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        page.drawText(cuota.fecha, {
          x: xFields + 135,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        page.drawText(cuota.valor, {
          x: xFields + 225,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        yFields -= 20;
      },
    );

    yFields -= 100;

    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop - 100; // Reiniciar la posición Y
    }

    page.drawRectangle({
      x: xFields,
      y: yFields,
      width: 140,
      height: 100,
      borderWidth: 2,
      borderColor: rgb(0.635, 0.635, 0.635),
      color: rgb(1, 1, 1),
      opacity: 0.5,
      borderOpacity: 0.75,
    });

    page.drawText('Firma Autorizada:', {
      x: xFields + 35,
      y: yFields + 90,
      font: fontBold,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    page.drawLine({
      start: { x: xFields + 25, y: yFields + 30 },
      end: { x: xFields + 120, y: yFields + 30 },
      thickness: 2,
      color: rgb(0.004, 0, 0.329),
      opacity: 0.75,
    });

    page.drawText('URB VISTALMAR', {
      x: xFields + 40,
      y: yFields + 20,
      font,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    xFields = xFields + 160;

    page.drawRectangle({
      x: xFields,
      y: yFields,
      width: 140,
      height: 100,
      borderWidth: 2,
      borderColor: rgb(0.635, 0.635, 0.635),
      color: rgb(1, 1, 1),
      opacity: 0.5,
      borderOpacity: 0.75,
    });

    page.drawText('Cliente:', {
      x: xFields + 55,
      y: yFields + 90,
      font: fontBold,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    page.drawLine({
      start: { x: xFields + 25, y: yFields + 30 },
      end: { x: xFields + 120, y: yFields + 30 },
      thickness: 2,
      color: rgb(0.004, 0, 0.329),
      opacity: 0.75,
    });

    page.drawText(data[fields[0].key], {
      x: xFields + 30,
      y: yFields + 20,
      font,
      size: fontSize,
      color: rgb(0, 0, 0),
    });

    yFields -= 10;

    xFields = 20;

    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop; // Reiniciar la posición Y
    }

    page.drawText('IMPORTANTE:', {
      x: xFields,
      y: yFields - 30,
      font: fontBold,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    page.drawLine({
      start: { x: xFields, y: yFields - 31 },
      end: { x: xFields + 70, y: yFields - 31 },
      thickness: 1,
      color: rgb(0, 0, 0),
    });

    yFields -= 50;

    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop; // Reiniciar la posición Y
    }

    // eslint-disable-next-line max-len
    page.drawText(
      '* Acercarse a firmar su contrato en un plazo máximo de 7 días, contados desde',
      {
        x: xFields,
        y: yFields,
        font,
        size: fontSize + 2,
        color: rgb(0, 0, 0),
      },
    );

    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop; // Reiniciar la posición Y
    }

    page.drawText('la presente fecha.', {
      x: xFields,
      y: yFields - 10,
      font,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop; // Reiniciar la posición Y
    }

    // eslint-disable-next-line max-len
    page.drawText(
      '* El o los abajo firmantes, autorizamos a solicitar y obtener mi información crediticia',
      {
        x: xFields,
        y: yFields - 30,
        font,
        size: fontSize + 2,
        color: rgb(0, 0, 0),
      },
    );

    if (yFields - rowHeight < footerHeight + marginBottom) {
      page = pdfDoc.addPage(PageSizes.Letter);
      yFields = height - marginTop; // Reiniciar la posición Y
    }

    page.drawText('en Buró de Créditos y Central de Riesgo.', {
      x: xFields,
      y: yFields - 40,
      font,
      size: fontSize + 2,
      color: rgb(0, 0, 0),
    });

    pdfDoc.getPages().forEach((p) => {
      // eslint-disable-next-line max-len
      this.drawFooter(p, fontBold, footerFontSize, width); // Dibujar solo el pie de página común
    });
    // Guardar el PDF en memoria
    return await pdfDoc.save();
  }

  private async generateLeadStatusPDF(
    pdfDoc: PDFDocument,
    data: any,
    options: any,
    logoImage: any,
    font: any,
    fontBold: any,
  ): Promise<Uint8Array> {
    let page = pdfDoc.addPage(PageSizes.Letter);
    const { width, height } = page.getSize();

    const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

    const fontSize = 8;
    const footerFontSize = 8;
    const footerMargin = 10;
    const rowHeight = 20;

    // Dibujar el logo
    page.drawImage(logoImage, {
      x: 35,
      y: height - logoDims.height - 20,
      width: logoDims.width,
      height: logoDims.height,
    });

    // Establecer las fuentes para el texto
    pdfDoc.registerFontkit(fontkit);

    // Título y fechas
    page.drawText('REPORTE DE LEADS', {
      x: 35,
      y: height - 130,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0.129, 0.302),
    });

    page.drawText('DESDE:', {
      x: 35,
      y: height - 160,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0.129, 0.302),
    });

    page.drawText(options.fechaInicio, {
      x: 35,
      y: height - 180,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText('HASTA:', {
      x: 235,
      y: height - 160,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0.129, 0.302),
    });

    page.drawText(options.fechaFin, {
      x: 235,
      y: height - 180,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    // Tabla de datos
    const tableTop = height - 200;
    const tableLeft = 35;
    let yPosition = tableTop;

    const headers = [
      { label: 'Estado', key: 'estado' },
      { label: 'Cantidad de Leads', key: 'cantidadDeLeads' },
      { label: 'Porcentaje', key: 'porcentaje' },
    ];
    const columnWidths = [240, 150, 150];

    // Dibujar los encabezados de la tabla
    headers.forEach((header, i) => {
      const xPosition =
        tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

      // Dibujar rectángulo de la celda del encabezado
      page.drawRectangle({
        x: xPosition,
        y: yPosition - rowHeight,
        width: columnWidths[i],
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      // Dibujar el texto del encabezado
      page.drawText(header.label, {
        x: xPosition + 5, // Padding para el texto
        y: yPosition - fontSize - 5, // Ajuste adicional para evitar superposición
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
    });

    // Ajustar yPosition para empezar con las filas de datos
    yPosition -= rowHeight;

    // Dibujar las filas de datos
    data.forEach((row: { [x: string]: string }) => {
      let maxLines = 1; // Para almacenar la cantidad máxima de líneas en una fila

      // Calcular el máximo de líneas en esta fila
      headers.forEach((header, i) => {
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] - 10,
          fontSize,
          font,
        );
        maxLines = Math.max(maxLines, lines.length);
      });

      const cellHeight = maxLines * rowHeight;
      const spaceForFooter = footerMargin + 85 + footerFontSize * 4;

      // Verificar si se necesita una nueva página
      if (yPosition - cellHeight < spaceForFooter) {
        page = pdfDoc.addPage(PageSizes.Letter);
        yPosition = height - 50;

        // Redibujar los encabezados en la nueva página
        headers.forEach((header, i) => {
          const xPosition =
            tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

          page.drawRectangle({
            x: xPosition,
            y: yPosition - rowHeight,
            width: columnWidths[i],
            height: rowHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
          });

          page.drawText(header.label, {
            x: xPosition + 5,
            y: yPosition - fontSize - 5,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          });
        });

        yPosition -= rowHeight;
      }

      // Dibujar cada celda de la fila
      headers.forEach((header, i) => {
        const xPosition =
          tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

        // Dibujar el rectángulo de la celda
        page.drawRectangle({
          x: xPosition,
          y: yPosition - cellHeight,
          width: columnWidths[i],
          height: cellHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText,
          columnWidths[i] - 10,
          fontSize,
          font,
        );

        // Dibujar cada línea de texto en la celda
        lines.forEach((line, lineIndex) => {
          const textYPosition =
            yPosition - (lineIndex + 1) * fontSize - 5 - lineIndex * 5;

          page.drawText(line, {
            x: xPosition + 5,
            y: textYPosition,
            size: fontSize,
            font,
            color: rgb(0, 0, 0),
          });
        });
      });

      // Ajustar yPosition para la siguiente fila
      yPosition -= cellHeight;
    });

    // Dibujar el pie de página si es necesario
    pdfDoc.getPages().forEach((p) => {
      this.drawFooter(p, fontBold, footerFontSize, width);
    });

    return await pdfDoc.save();
  }

  private async generateSeguimientoPDF(
    pdfDoc: PDFDocument,
    data: any,
    options: any,
    logoImage: any,
    font: any,
    fontBold: any,
  ): Promise<Uint8Array> {
    // Crear un nuevo documento PDF tamaño carta
    let page = pdfDoc.addPage(PageSizes.Letter);
    const { width, height } = page.getSize();

    // eslint-disable-next-line max-len
    // Cargar la imagen de la captura de pantalla (la imagen debe estar en una URL accesible públicamente)
    const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

    const fontSize = 8;
    const footerFontSize = 8;
    const footerMargin = 10;
    const rowHeight = 20; // Altura base de una fila (para una línea de texto)

    // Dibujar el logo en la página
    page.drawImage(logoImage, {
      x: 35,
      y:
        logoDims.height > 90
          ? height - logoDims.height
          : height - logoDims.height - 20,
      width: logoDims.width,
      height: logoDims.height > 90 ? logoDims.height - 20 : logoDims.height,
    });

    // Establecer las fuentes para el texto
    pdfDoc.registerFontkit(fontkit);

    // Título
    // Título: "Nombre del Reporte"
    page.drawText(options.nombre, {
      x: 35,
      y: height - 130,
      size: fontSize,
      font: fontBold,
      color: rgb(0, 0.129, 0.302),
    });

    // Tabla de datos
    const tableTop = height - 160;
    const tableLeft = 35;
    let yPosition = tableTop;

    const headers = [
      { label: '#', key: 'contador' },
      { label: 'Origen', key: 'origen' },
      { label: 'Nombre', key: 'nombre' },
      { label: 'Apellido', key: 'apellido' },
      { label: 'Correo', key: 'email' },
      { label: 'Teléfono', key: 'telefono' },
    ];
    const columnWidths = [30, 120, 100, 100, 120, 66];

    // 1. Dibujar los encabezados de la tabla
    headers.forEach((header, i) => {
      const xPosition =
        tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

      // Dibujar rectángulo de la celda del encabezado
      page.drawRectangle({
        x: xPosition,
        y: yPosition - rowHeight,
        width: columnWidths[i],
        height: rowHeight,
        borderColor: rgb(0, 0, 0),
        borderWidth: 1,
      });

      // Dibujar el texto del encabezado
      page.drawText(header.label, {
        x: xPosition + 5, // Padding para el texto
        y: yPosition - fontSize - 5, // Ajuste adicional para evitar superposición
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
    });

    // Ajustar yPosition para empezar con las filas de datos
    yPosition -= rowHeight;

    // 2. Dibujar filas de datos y bordes
    data.forEach((row: { [x: string]: string }) => {
      let maxLines = 1; // Para almacenar la cantidad máxima de líneas en una fila

      // 2.1. Calcular el máximo de líneas para cualquier columna en la fila actual
      headers.forEach((header, i) => {
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] - 10, // Restar padding para que el texto no se corte
          fontSize,
          font,
        );
        maxLines = Math.max(maxLines, lines.length);
      });

      // 2.2. Verificar si hay espacio suficiente en la página para esta fila
      const cellHeight = maxLines * rowHeight;
      const spaceForFooter = footerMargin + 85 + footerFontSize * 4;

      if (yPosition - cellHeight < spaceForFooter) {
        // Añadir nueva página si no hay espacio suficiente
        page = pdfDoc.addPage(PageSizes.Letter);
        yPosition = height - 50; // Reiniciar yPosition para la nueva página

        // Redibujar los encabezados en la nueva página
        headers.forEach((header, i) => {
          const xPosition =
            tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

          page.drawRectangle({
            x: xPosition,
            y: yPosition - rowHeight,
            width: columnWidths[i],
            height: rowHeight,
            borderColor: rgb(0, 0, 0),
            borderWidth: 1,
          });

          page.drawText(header.label, {
            x: xPosition + 5,
            y: yPosition - fontSize - 5,
            size: fontSize,
            font: fontBold,
            color: rgb(0, 0, 0),
          });
        });

        yPosition -= rowHeight;
      }

      // 2.3. Dibujar cada celda de la fila
      headers.forEach((header, i) => {
        const xPosition =
          tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);

        // Dibujar el rectángulo de la celda
        page.drawRectangle({
          x: xPosition,
          y: yPosition - cellHeight,
          width: columnWidths[i],
          height: cellHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        // Obtener el texto de la celda y dividirlo en líneas
        const cellText = row[header.key] ? row[header.key].toString() : '';
        const lines = this.splitTextIntoLines(
          cellText,
          columnWidths[i] - 10,
          fontSize,
          font,
        );

        // 2.4. Dibujar cada línea de texto en la celda
        lines.forEach((line, lineIndex) => {
          const textYPosition =
            yPosition - (lineIndex + 1) * fontSize - 5 - lineIndex * 5;

          page.drawText(line, {
            x: xPosition + 5,
            y: textYPosition,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });
      });

      // 2.5. Ajustar yPosition para la siguiente fila
      yPosition -= cellHeight;
    });

    // 3. Dibujar el pie de página en la última página
    pdfDoc.getPages().forEach((p, index) => {
      if (index === pdfDoc.getPageCount() - 1) {
        this.drawFooter(p, font, footerFontSize, width);
      }
    });

    return await pdfDoc.save();
  }
}
