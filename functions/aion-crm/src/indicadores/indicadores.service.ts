import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { Firestore, getFirestore, Timestamp } from 'firebase-admin/firestore';

@Injectable()
export class IndicadoresService {
  private db: Firestore;

  constructor() {
    this.db = getFirestore();
  }
  async update(): Promise<string> {
    try {
      // Obtener la fecha actual
      const ahora = new Date();
      const diaDespues = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate() + 1,
      );

      // Calcular el primer día del mes actual
      const primerDiaMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
      // Calcular el primer día del próximo mes
      const primerDiaProximoMes = new Date(
        ahora.getFullYear(),
        ahora.getMonth() + 1,
        1,
      );

      const primerDiaDosMeses = new Date(
        ahora.getFullYear(),
        ahora.getMonth() + 2,
        1,
      );

      const fechaActual = new Date(
        ahora.getFullYear(),
        ahora.getMonth(),
        ahora.getDate(),
        5,
      );

      const diasVencidos = ahora;
      diasVencidos.setDate(ahora.getDate() - 89);

      const diasRiesgo = ahora;
      diasVencidos.setDate(ahora.getDate() - 90);

      const initDate = new Date(0);

      // Convertir las fechas a Timestamps de Firebase
      const diaDespuesTimestamp = Timestamp.fromDate(diaDespues);
      const inicioTimestamp = Timestamp.fromDate(primerDiaMes);
      const finTimestamp = Timestamp.fromDate(primerDiaProximoMes);
      const finDosMesTimestamp = Timestamp.fromDate(primerDiaDosMeses);
      const diasVencidosTimestamp = Timestamp.fromDate(diasVencidos);
      const diasRiesgoTimestamp = Timestamp.fromDate(diasRiesgo);
      const initDateTimestamp = Timestamp.fromDate(initDate);
      const fechaActualTimestamp = Timestamp.fromDate(fechaActual);

      // Obtener el conteo
      const nuevosProspectos = await this.nuevosProspectos(
        inicioTimestamp,
        finTimestamp,
      );
      const seguimientosRealizados = await this.seguimientosRealizados(
        inicioTimestamp,
        finTimestamp,
      );

      const prospectosContactados = await this.prospectosContactados(
        inicioTimestamp,
        finTimestamp,
      );

      const conversionesReservas = await this.conversionesReservas(
        inicioTimestamp,
        finTimestamp,
      );

      const carteraTotal = await this.carteraTotal();

      const carteraRecuperada =
        await this.carteraRecuperada(diaDespuesTimestamp);

      const correosEnviados = await this.followUpTypeEnviados(
        inicioTimestamp,
        finTimestamp,
        'Email',
      );

      const whatsAppEnviados = await this.followUpTypeEnviados(
        inicioTimestamp,
        finTimestamp,
        'WhatsApp',
      );

      const llamadasEnviadas = await this.followUpTypeEnviados(
        inicioTimestamp,
        finTimestamp,
        'Llamada',
      );

      const prospectosInteresados = await this.prospectosInteresados(
        inicioTimestamp,
        finTimestamp,
      );

      const conversionesEfectivas = await this.conversionesEfectivas(
        inicioTimestamp,
        finTimestamp,
      );

      const lotesDisponibles = await this.lotes(false, false);
      const lotesReservados = await this.lotes(true, false);
      const lotesVendidos = await this.lotes(true, true);
      const gestionesEfectuadas = await this.gestionesEfectuadas(
        inicioTimestamp,
        finTimestamp,
      );

      const carteraRecuperadaMes = await this.carteraRecuperadaMes(
        inicioTimestamp,
        finTimestamp,
      );

      const cuentasCobrarAcumuladasCuota = await this.cuentasCobrarAcumuladas(
        finTimestamp,
        'cuota',
      );

      const cuentasCobrarAcumuladasAlicuota =
        await this.cuentasCobrarAcumuladas(finTimestamp, 'alicuota');

      const cuentasCobrarMesCuota = await this.cuentasCobrar(
        inicioTimestamp,
        finTimestamp,
        'cuota',
      );

      const cuentasCobrarMesAlicuota = await this.cuentasCobrar(
        inicioTimestamp,
        finTimestamp,
        'alicuota',
      );

      const cuentasCobrarProxMesCuota = await this.cuentasCobrar(
        finTimestamp,
        finDosMesTimestamp,
        'cuota',
      );

      const cuentasCobrarProxMesAlicuota = await this.cuentasCobrar(
        finTimestamp,
        finDosMesTimestamp,
        'alicuota',
      );

      const carteraVencidaCuota = await this.cartera(
        diasVencidosTimestamp,
        inicioTimestamp,
        'cuota',
      );

      const carteraVencidaAlicuota = await this.cartera(
        diasVencidosTimestamp,
        inicioTimestamp,
        'alicuota',
      );

      const carteraRiesgoCuota = await this.cartera(
        initDateTimestamp,
        diasRiesgoTimestamp,
        'cuota',
      );

      const carteraRiesgoAlicuota = await this.cartera(
        initDateTimestamp,
        diasRiesgoTimestamp,
        'alicuota',
      );

      await this.db.collection('indicadores').add({
        nuevosProspectos,
        seguimientosRealizados,
        prospectosContactados,
        conversionesReservas,
        carteraTotal,
        carteraRecuperada,
        correosEnviados,
        whatsAppEnviados,
        llamadasEnviadas,
        prospectosInteresados,
        conversionesEfectivas,
        lotesDisponibles,
        lotesReservados,
        lotesVendidos,
        gestionesEfectuadas,
        carteraRecuperadaMes,
        cuentasCobrarAcumuladasCuota,
        cuentasCobrarAcumuladasAlicuota,
        cuentasCobrarMesCuota,
        cuentasCobrarMesAlicuota,
        cuentasCobrarProxMesCuota,
        cuentasCobrarProxMesAlicuota,
        carteraVencidaCuota,
        carteraVencidaAlicuota,
        carteraRiesgoCuota,
        carteraRiesgoAlicuota,
        fecha: fechaActualTimestamp,
      });

      return 'Indicadores actualizados correctamente.';
    } catch (error) {
      this.handleError(error);
    }
  }

  private async nuevosProspectos(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const contactosRef = this.db.collection('contactos');
      const countQuery = contactosRef
        .where('registrationDate', '>=', initDate)
        .where('registrationDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en nuevosProspectos:', error);
      throw new Error('Error al calcular el conteo de contactos.');
    }
  }

  private async seguimientosRealizados(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const leadFollowUpsRef = this.db.collection('leadFollowUps');
      const countQuery = leadFollowUpsRef
        .where('leadOrCollection', '==', 'lead')
        .where('followUpDate', '>=', initDate)
        .where('followUpDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en seguimientosRealizados:', error);
      throw new Error('Error al calcular el conteo de leadFollowUps.');
    }
  }

  private async prospectosContactados(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const leadFollowUpsRef = this.db.collection('leadFollowUps');
      const snapshot = await leadFollowUpsRef
        .where('followUpDate', '>=', initDate)
        .where('followUpDate', '<', finalDate)
        .get();

      // Usar un Set para almacenar valores únicos de leadRefence
      const uniqueLeadReferences = new Set<string>();

      snapshot.forEach((doc) => {
        const data = doc.data();
        const leadReference = data.leadReference; // Asegúrate del nombre correcto del campo

        if (leadReference && typeof leadReference === 'string') {
          uniqueLeadReferences.add(leadReference);
        }
      });

      // Retornar el conteo de valores únicos
      return uniqueLeadReferences.size;
    } catch (error) {
      console.error('Error en prospectosContactados:', error);
      throw new Error('Error al calcular el conteo de leadFollowUps.');
    }
  }

  private async conversionesReservas(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const countQuery = paymentsRef
        .where('paymentType', '==', 'Reserva')
        .where('registerDate', '>=', initDate)
        .where('registerDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en conversionesReservas:', error);
      throw new Error('Error al calcular el conteo de payments.');
    }
  }

  private async carteraTotal(): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const querySnapshot = await paymentsRef
        .where('isPaid', '==', false)
        .select('paymentValue') // Selecciona solo el campo necesario para optimizar
        .get(); // Utiliza la agregación count()

      let sumaTotal = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const paymentValue = data.paymentValue;

        if (typeof paymentValue === 'number') {
          sumaTotal += paymentValue;
        } else {
          console.warn(
            `El documento con ID ${doc.id} tiene un paymentValue inválido:`,
            paymentValue,
          );
        }
      });

      return sumaTotal;
    } catch (error) {
      console.error('Error en carteraTotal:', error);
      throw new Error('Error al calcular la sumatoria de paymentValue.');
    }
  }

  private async carteraRecuperada(diaDespues: Timestamp): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const querySnapshot = await paymentsRef
        .where('isPaid', '==', true)
        .where('realDate', '<', diaDespues)
        .select('paymentValue') // Selecciona solo el campo necesario para optimizar
        .get();

      let sumaTotal = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const paymentValue = data.paymentValue;

        if (typeof paymentValue === 'number') {
          sumaTotal += paymentValue;
        } else {
          console.warn(
            `El documento con ID ${doc.id} tiene un paymentValue inválido:`,
            paymentValue,
          );
        }
      });

      return sumaTotal;
    } catch (error) {
      console.error('Error en carteraRecuperada:', error);
      throw new Error('Error al calcular la sumatoria de paymentValue.');
    }
  }

  private async carteraRecuperadaMes(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const querySnapshot = await paymentsRef
        .where('isPaid', '==', true)
        .where('realDate', '>=', initDate)
        .where('realDate', '<', finalDate)
        .select('paymentValue') // Selecciona solo el campo necesario para optimizar
        .get();

      let sumaTotal = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const paymentValue = data.paymentValue;

        if (typeof paymentValue === 'number') {
          sumaTotal += paymentValue;
        } else {
          console.warn(
            `El documento con ID ${doc.id} tiene un paymentValue inválido:`,
            paymentValue,
          );
        }
      });

      return sumaTotal;
    } catch (error) {
      console.error('Error en carteraRecuperadaMes:', error);
      throw new Error('Error al calcular la sumatoria de paymentValue.');
    }
  }

  private async followUpTypeEnviados(
    initDate: Timestamp,
    finalDate: Timestamp,
    followUpType: string,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const leadFollowUpsRef = this.db.collection('leadFollowUps');
      const countQuery = leadFollowUpsRef
        .where('leadOrCollection', '==', 'lead')
        .where('followUpType', '==', followUpType)
        .where('followUpDate', '>=', initDate)
        .where('followUpDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en followUpTypes:', error);
      throw new Error('Error al calcular el conteo de leadFollowUps.');
    }
  }

  private async prospectosInteresados(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    // Definir los valores permitidos para 'status'
    const statusValores = [
      'Pendiente coordinar cita en obra',
      'Cita en oficina',
      'Cita en obra',
      'Dar seguimiento',
      'Reserva',
    ];
    try {
      // Realizar la consulta de agregación a Firestore
      const leadFollowUpsRef = this.db.collection('leadFollowUps');
      const countQuery = leadFollowUpsRef
        .where('leadOrCollection', '==', 'lead')
        .where('status', 'in', statusValores)
        .where('followUpDate', '>=', initDate)
        .where('followUpDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en prospectosInteresados:', error);
      throw new Error('Error al calcular el conteo de leadFollowUps.');
    }
  }

  private async conversionesEfectivas(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const leadFollowUpsRef = this.db.collection('leadFollowUps');
      const countQuery = leadFollowUpsRef
        .where('leadOrCollection', '==', 'lead')
        .where('status', '==', 'Reserva')
        .where('followUpDate', '>=', initDate)
        .where('followUpDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en conversionesEfectivas:', error);
      throw new Error('Error al calcular el conteo de leadFollowUps.');
    }
  }

  private async lotes(reservado: boolean, vendido: boolean): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const landsRef = this.db.collection('lands');
      const countQuery = landsRef
        .where('isReserved', '==', reservado)
        .where('isSold', '==', vendido)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en lotes:', error);
      throw new Error('Error al calcular el conteo de lands.');
    }
  }

  private async gestionesEfectuadas(
    initDate: Timestamp,
    finalDate: Timestamp,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const leadFollowUpsRef = this.db.collection('leadFollowUps');
      const countQuery = leadFollowUpsRef
        .where('leadOrCollection', '==', 'collection')
        .where('followUpDate', '>=', initDate)
        .where('followUpDate', '<', finalDate)
        .count(); // Utiliza la agregación count()

      const aggregateQuerySnapshot = await countQuery.get();

      return aggregateQuerySnapshot.data().count;
    } catch (error) {
      console.error('Error en gestionesEfectuadas:', error);
      throw new Error('Error al calcular el conteo de leadFollowUps.');
    }
  }

  private async cuentasCobrarAcumuladas(
    finalDate: Timestamp,
    paymentType: string,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const querySnapshot = await paymentsRef
        .where('paymentType', '==', paymentType)
        .where('planDate', '<', finalDate)
        .select('paymentValue') // Selecciona solo el campo necesario para optimizar
        .get();

      let sumaTotal = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const paymentValue = data.paymentValue;

        if (typeof paymentValue === 'number') {
          sumaTotal += paymentValue;
        } else {
          console.warn(
            `El documento con ID ${doc.id} tiene un paymentValue inválido:`,
            paymentValue,
          );
        }
      });

      return sumaTotal;
    } catch (error) {
      console.error('Error en cuentasCobrarAcumuladas:', error);
      throw new Error('Error al calcular la sumatoria de paymentValue.');
    }
  }

  private async cuentasCobrar(
    initDate: Timestamp,
    finalDate: Timestamp,
    paymentType: string,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const querySnapshot = await paymentsRef
        .where('paymentType', '==', paymentType)
        .where('planDate', '>=', initDate)
        .where('planDate', '<', finalDate)
        .select('paymentValue') // Selecciona solo el campo necesario para optimizar
        .get();

      let sumaTotal = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const paymentValue = data.paymentValue;

        if (typeof paymentValue === 'number') {
          sumaTotal += paymentValue;
        } else {
          console.warn(
            `El documento con ID ${doc.id} tiene un paymentValue inválido:`,
            paymentValue,
          );
        }
      });

      return sumaTotal;
    } catch (error) {
      console.error('Error en cuentasCobrar:', error);
      throw new Error('Error al calcular la sumatoria de paymentValue.');
    }
  }

  private async cartera(
    initDate: Timestamp,
    finalDate: Timestamp,
    paymentType: string,
  ): Promise<number> {
    try {
      // Realizar la consulta de agregación a Firestore
      const paymentsRef = this.db.collection('payments');
      const querySnapshot = await paymentsRef
        .where('paymentType', '==', paymentType)
        .where('planDate', '>=', initDate)
        .where('planDate', '<', finalDate)
        .select('paymentValue') // Selecciona solo el campo necesario para optimizar
        .get();

      let sumaTotal = 0;
      querySnapshot.forEach((doc) => {
        const data = doc.data();
        const paymentValue = data.paymentValue;

        if (typeof paymentValue === 'number') {
          sumaTotal += paymentValue;
        } else {
          console.warn(
            `El documento con ID ${doc.id} tiene un paymentValue inválido:`,
            paymentValue,
          );
        }
      });

      return sumaTotal;
    } catch (error) {
      console.error('Error en cartera:', error);
      throw new Error('Error al calcular la sumatoria de paymentValue.');
    }
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
