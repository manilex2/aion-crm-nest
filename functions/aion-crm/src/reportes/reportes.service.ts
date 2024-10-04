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
              surnames: any;
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
            apellido: row.data.surnames ? row.data.surnames : '',
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
        await file.save(pdfBytes, {
          metadata: {
            contentType: 'application/pdf',
            cacheControl: 'public, max-age=31536000',
          },
        });

        console.log(
          `El PDF grupo ${index + 1} ha sido subido a ${destination}`,
        );

        const url = `https://firebasestorage.googleapis.com/v0/b/aion-crm-asm.appspot.com/o/${encodeURIComponent(
          destination,
        )}?alt=media`;

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
        email: `${clientData.email || ''}`,
        cedula: `${clientData.idNumber || ''}`,
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
        cuotasMens: {
          value1: `${cotizacionData.monthQuotasAmount || ''}`,
          value2: `${
            cotizacionData.monthQuotasValue
              ? cotizacionData.monthQuotasValue.toLocaleString('en-US', {
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

      const firstExpirationDate = DateTime.fromJSDate(
        cotizacionData.firstExpiration.toDate(),
      );

      for (let i = 0; i < parseInt(cotizacionData.monthQuotasAmount); i++) {
        const fechaCuota = firstExpirationDate
          .plus({ months: i })
          .toFormat('dd/MM/yyyy');

        resultados.cuotasTotales.push({
          numCuota: i + 1,
          valor: cotizacionData.monthQuotasValue.toLocaleString('en-US', {
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
      await file.save(pdfBytes, {
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000',
        },
      });

      console.log(`El PDF ha sido subido a ${destination}`);

      await this.db.collection('landsQuote').doc(landsQuoteId).update({
        registrationDate: FieldValue.serverTimestamp(),
        landQuoteUrl: file.baseUrl,
      });

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });

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
      await file.save(pdfBytes, {
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000',
        },
      });

      console.log(`El PDF ha sido subido a ${destination}`);

      const [url] = await file.getSignedUrl({
        action: 'read',
        expires: Date.now() + 60 * 60 * 1000,
      });

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
    const { source, lastLeadStatus, logoUrl, nombre, fecha } = req.body;

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

    if (!fecha) {
      throw new HttpException(
        'No se proporcionó la fecha',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const leadsContactFailData = [];
      let limitReached = false;

      for (const src of source) {
        if (limitReached) break;

        for (const statusId of lastLeadStatus) {
          if (limitReached) break;

          const querySnapshot = await this.db
            .collection('contactos')
            .where('source', '==', src)
            .where('lastLeadStatus', '==', statusId)
            .limit(100 - leadsContactFailData.length)
            .get();

          const leads = querySnapshot.docs.map((leadContact) => ({
            docReference: leadContact.ref,
            data: leadContact.data(),
          }));
          leadsContactFailData.push(...leads);

          if (leadsContactFailData.length >= 100) {
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

      const pdfDocIds = [];

      let count = 0;

      const resultados = leadsContactFailData.map((row) => ({
        contador: count++,
        origen: row.data.source || '',
        nombre: row.data.names ? row.data.names : '',
        apellido: row.data.surnames ? row.data.surnames : '',
        correo: row.data.email ? row.data.email : '',
        telefono: row.data.phone ? row.data.phone : '',
      }));

      const pdfBytes = await this.generatePDF('seguimiento', resultados, {
        logoUrl,
        nombre,
      });

      const formattedDate = fecha.toFormat('dd-MM-yyyy');

      const destination = `pdfs/seguimiento/${nombre}_${formattedDate}.pdf`;

      const file = this.storage.file(destination);
      await file.save(pdfBytes, {
        metadata: {
          contentType: 'application/pdf',
          cacheControl: 'public, max-age=31536000',
        },
      });

      console.log(`El seguimiento PDF ha sido subido a ${destination}`);

      const url = `https://firebasestorage.googleapis.com/v0/b/aion-crm-asm.appspot.com/o/${encodeURIComponent(
        destination,
      )}?alt=media`;

      const docRef = await this.db.collection('pdfSeguimientos').add({
        url: url,
        fecha: fecha.toJSDate(),
        contactos: lastLeadStatus.map((row) => row.docReference),
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
      'src/fonts/montserrat 2/Montserrat-Regular.otf',
    );
    const fontBytesBold = fs.readFileSync(
      'src/fonts/montserrat 2/Montserrat-Bold.otf',
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
    text: string,
    maxWidth: number,
    fontSize: number,
    font: any,
  ): string[] {
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
    const rowHeight = 20;
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
        y: yPosition - fontSize - 2, // Ajuste adicional para evitar superposición
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
    });

    // Ajustar yPosition para empezar con las filas de datos
    yPosition -= rowHeight;

    // Dibujar filas de datos y bordes
    data.forEach((row: { [x: string]: string }, index: number) => {
      let maxLines = 1; // Para almacenar la cantidad máxima de líneas en una fila

      // Calcular el máximo de líneas para cualquier columna en la fila actual
      headers.forEach((header, i) => {
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] + 30,
          fontSize,
          font,
        );
        maxLines = Math.max(maxLines, lines.length);
      });

      const spaceForFooter = footerMargin + 85 + footerFontSize * 4;
      // eslint-disable-next-line max-len
      if (
        index === data.length - 1 &&
        yPosition - maxLines * rowHeight < spaceForFooter
      ) {
        page = pdfDoc.addPage([1280, 792]);
        yPosition = height - 50; // Reiniciar yPosition para la nueva página
      } else if (yPosition - maxLines * rowHeight < 60 + footerMargin) {
        page = pdfDoc.addPage([1280, 792]);
        yPosition = height - 50; // Reiniciar yPosition para la nueva página
      }

      headers.forEach((header, i) => {
        const xPosition =
          tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
        const cellHeight = maxLines * rowHeight;

        // Dibujar el rectángulo de la celda
        page.drawRectangle({
          x: xPosition,
          y: yPosition - cellHeight,
          width: columnWidths[i],
          height: cellHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        // Obtener el valor de la celda correspondiente usando la clave correcta
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i],
          fontSize,
          font,
        );

        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xPosition + 5,
            y: yPosition - lineIndex * rowHeight - 15,
            size: header.label == 'Comentario' ? fontSize - 2 : fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });
      });

      // Ajustar yPosition para la siguiente fila
      yPosition -= maxLines * rowHeight;
    });

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

    const image1Bytes = await fetch(options.planoUrl).then((res) =>
      res.arrayBuffer(),
    );
    const image1Image = await pdfDoc.embedJpg(image1Bytes);
    const image1Dims = image1Image.scale(0.2);

    const marginTop = 50;
    const marginBottom = 50; // Margen inferior para el contenido antes del footer
    const footerHeight = 60; // Altura reservada para el footer
    const fontSize = 8;
    const footerFontSize = 8;

    // Dibujar el logo en la página
    page.drawImage(logoImage, {
      x: width / 3,
      y:
        logoDims.height > 90
          ? height - logoDims.height
          : height - logoDims.height - 20,
      width: logoDims.width * 2,
      height: logoDims.height > 90 ? logoDims.height : logoDims.height * 1.2,
    });

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
      { label: 'Cuotas mensuales:', key: 'cuotasMens' },
      { label: 'Primer Vencimiento:', key: 'firstExpiration' },
      { label: 'Saldo CRÉDITO BANCARIO:', key: 'saldo' },
    ];

    const rowHeight = 20;

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
        page.drawRectangle({
          x: xFields + 100,
          y: yFields - 5,
          width: 50,
          height: rowHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        page.drawRectangle({
          x: xFields + 160,
          y: yFields - 5,
          width: 140,
          height: rowHeight,
          borderColor: rgb(0.635, 0.635, 0.635),
          borderWidth: 1,
        });

        page.drawText(data[field.key].value1, {
          x: xFields + 110,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        page.drawText(data[field.key].value2, {
          x: xFields + 170,
          y: yFields,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });

        yFields -= 30;

        return;
      }

      page.drawRectangle({
        x: xFields + 100,
        y: yFields - 5,
        width: 200,
        height: rowHeight,
        borderColor: rgb(0.635, 0.635, 0.635),
        borderWidth: 1,
      });

      page.drawText(data[field.key], {
        x: xFields + 110,
        y: yFields,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      });

      yFields -= 30;
    });

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

    page.drawText('Cuota', {
      x: xFields + 95,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText('Fecha', {
      x: xFields + 135,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    page.drawText('Valor', {
      x: xFields + 225,
      y: yFields,
      size: fontSize,
      font,
      color: rgb(0, 0, 0),
    });

    yFields -= 20;

    data.cuotasTotales.forEach(
      (cuota: { numCuota: any; fecha: string; valor: string }) => {
        if (yFields - rowHeight < footerHeight + marginBottom) {
          page = pdfDoc.addPage(PageSizes.Letter);
          yFields = height - marginTop; // Reiniciar la posición Y
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
    const page = pdfDoc.addPage(PageSizes.Letter);
    const { height } = page.getSize();

    const logoDims = logoImage.scale(0.5); // Escalar la imagen si es necesario

    const fontSize = 8;
    // const footerFontSize = 8;

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
    // Título: "REPORTE DE LEADS"
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
      font: font,
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
      font: font,
      color: rgb(0, 0, 0),
    });

    // Tabla de datos
    const tableTop = height - 200;
    const tableLeft = 35;
    const rowHeight = 20;
    let yPosition = tableTop;

    const headers = [
      { label: 'Estado', key: 'estado' },
      { label: 'Cantidad de Leads', key: 'cantidadDeLeads' },
      { label: 'Porcentaje', key: 'porcentaje' },
    ];
    const columnWidths = [240, 150, 150];

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
        y: yPosition - fontSize - 2, // Ajuste adicional para evitar superposición
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
    });

    // Ajustar yPosition para empezar con las filas de datos
    yPosition -= rowHeight;

    // Dibujar filas de datos y bordes
    data.forEach((row: { [x: string]: string }) => {
      let maxLines = 1; // Para almacenar la cantidad máxima de líneas en una fila

      // Calcular el máximo de líneas para cualquier columna en la fila actual
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

      /* Dibujar el contenido y los bordes de cada celda,
    basándose en el máximo de líneas */
      headers.forEach((header, i) => {
        const xPosition =
          tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
        const cellHeight = maxLines * rowHeight;

        // Dibujar el rectángulo de la celda
        page.drawRectangle({
          x: xPosition,
          y: yPosition - cellHeight,
          width: columnWidths[i],
          height: cellHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        // Obtener el valor de la celda correspondiente usando la clave correcta
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] - 10,
          fontSize,
          font,
        );

        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xPosition + 5,
            y: yPosition - lineIndex * rowHeight - 15,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });
      });

      // Ajustar yPosition para la siguiente fila
      yPosition -= maxLines * rowHeight;
    });

    /* pdfDoc.getPages().forEach((p) => {
    drawFooter(p, font, footerFontSize, width);
  }); */
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
    const rowHeight = 20;
    let yPosition = tableTop;

    const headers = [
      { label: '#', key: 'contador' },
      { label: 'Origen', key: 'origen' },
      { label: 'Nombre', key: 'nombre' },
      { label: 'Apellido', key: 'apellido' },
      { label: 'Correo', key: 'email' },
      { label: 'Teléfono', key: 'telefono' },
    ];
    const columnWidths = [20, 90, 100, 100, 150, 66];

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
        y: yPosition - fontSize - 2, // Ajuste adicional para evitar superposición
        size: fontSize,
        font: font,
        color: rgb(0, 0, 0),
      });
    });

    // Ajustar yPosition para empezar con las filas de datos
    yPosition -= rowHeight;

    // Dibujar filas de datos y bordes
    data.forEach((row: { [x: string]: string }, index: number) => {
      let maxLines = 1; // Para almacenar la cantidad máxima de líneas en una fila

      // Calcular el máximo de líneas para cualquier columna en la fila actual
      headers.forEach((header, i) => {
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] + 30,
          fontSize,
          font,
        );
        maxLines = Math.max(maxLines, lines.length);
      });

      const spaceForFooter = footerMargin + 85 + footerFontSize * 4;
      // eslint-disable-next-line max-len
      if (
        index === data.length - 1 &&
        yPosition - maxLines * rowHeight < spaceForFooter
      ) {
        page = pdfDoc.addPage([1280, 792]);
        yPosition = height - 50; // Reiniciar yPosition para la nueva página
      } else if (yPosition - maxLines * rowHeight < 60 + footerMargin) {
        page = pdfDoc.addPage([1280, 792]);
        yPosition = height - 50; // Reiniciar yPosition para la nueva página
      }

      headers.forEach((header, i) => {
        const xPosition =
          tableLeft + columnWidths.slice(0, i).reduce((a, b) => a + b, 0);
        const cellHeight = maxLines * rowHeight;

        // Dibujar el rectángulo de la celda
        page.drawRectangle({
          x: xPosition,
          y: yPosition - cellHeight,
          width: columnWidths[i],
          height: cellHeight,
          borderColor: rgb(0, 0, 0),
          borderWidth: 1,
        });

        // Obtener el valor de la celda correspondiente usando la clave correcta
        const cellText = row[header.key] || '';
        const lines = this.splitTextIntoLines(
          cellText.toString(),
          columnWidths[i] - 10,
          fontSize,
          font,
        );

        lines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: xPosition + 5,
            y: yPosition - lineIndex * rowHeight - 15,
            size: fontSize,
            font: font,
            color: rgb(0, 0, 0),
          });
        });
      });

      // Ajustar yPosition para la siguiente fila
      yPosition -= maxLines * rowHeight;
    });

    pdfDoc.getPages().forEach((p, index) => {
      if (index === pdfDoc.getPageCount() - 1) {
        this.drawFooter(p, font, footerFontSize, width);
      }
    });

    return await pdfDoc.save();
  }
}
