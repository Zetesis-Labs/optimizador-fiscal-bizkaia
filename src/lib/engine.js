export const CREDITO_MAX = 36000;
export const INVERSION_MAX_ANUAL = 8500;

// ---- Escala del ahorro desde 1/1/2026 (NF 2/2025) ----
export const ESCALA_AHORRO = [
  { hasta: 7500, tipo: 0.19 },
  { hasta: 15000, tipo: 0.2 },
  { hasta: 30000, tipo: 0.22 },
  { hasta: 50000, tipo: 0.24 },
  { hasta: 90000, tipo: 0.255 },
  { hasta: 120000, tipo: 0.26 },
  { hasta: 240000, tipo: 0.265 },
  { hasta: 300000, tipo: 0.27 },
  { hasta: Infinity, tipo: 0.28 },
];

export function cuotaAhorro(base) {
  let cuota = 0;
  let prev = 0;
  for (const t of ESCALA_AHORRO) {
    if (base <= prev) break;
    cuota += (Math.min(base, t.hasta) - prev) * t.tipo;
    prev = t.hasta;
  }
  return Math.max(0, cuota);
}


// ---- Tarifa general 2026 (NF 7/2025, deflactada 2 %) ----
export const ESCALA_GENERAL = [
  { hasta: 18080, tipo: 0.23 },
  { hasta: 36160, tipo: 0.28 },
  { hasta: 54240, tipo: 0.35 },
  { hasta: 77450, tipo: 0.40 },
  { hasta: 107260, tipo: 0.45 },
  { hasta: 142960, tipo: 0.46 },
  { hasta: 208390, tipo: 0.47 },
  { hasta: Infinity, tipo: 0.49 },
];
export const MINORACION_CUOTA = 1615; // por declaración (2026)
export const EPSV_MAX_INDIVIDUAL = 5000; // límite anual de aportación individual reducible
export const EPSV_MAX_EMPRESA = 8000; // límite de contribuciones empresariales
export const EPSV_MAX_CONJUNTO = 10000; // límite conjunto individual + empresarial

// Aportación individual reducible en base, respetando el límite conjunto
// (la contribución empresarial se imputa y reduce, neutra dentro de sus límites)
export function epsvReducible(individual, empresa = 0) {
  const emp = Math.min(Math.max(0, empresa), EPSV_MAX_EMPRESA);
  return Math.min(
    Math.max(0, individual),
    EPSV_MAX_INDIVIDUAL,
    Math.max(0, EPSV_MAX_CONJUNTO - emp)
  );
}
export const SS_PCT = 0.065; // cotizaciones del trabajador aprox. (incl. MEI)

export function cuotaGeneral(base) {
  let cuota = 0;
  let prev = 0;
  for (const t of ESCALA_GENERAL) {
    if (base <= prev) break;
    cuota += (Math.min(base, t.hasta) - prev) * t.tipo;
    prev = t.hasta;
  }
  return Math.max(0, cuota);
}

// Bonificación de rendimientos de trabajo de Bizkaia (importes generales)
export function bonificacionTrabajo(netoPrevio) {
  if (netoPrevio <= 7500) return 4650;
  if (netoPrevio <= 15000) return 4650 - 0.22 * (netoPrevio - 7500);
  return 3000;
}

// Ingresos → base liquidable general según tipo de contribuyente:
// "trabajador": sueldo bruto − cotizaciones (~6,5 %) − bonificación de trabajo
// "autonomo": rendimiento neto de la actividad (ingresos − gastos, incl. cuota RETA),
//             sin bonificación de trabajo
export function baseLiquidableGeneral(ingreso, epsv = 0, tipo = "trabajador") {
  let neto;
  if (tipo === "autonomo") {
    neto = Math.max(0, ingreso);
  } else {
    const netoPrevio = Math.max(0, ingreso * (1 - SS_PCT));
    neto = Math.max(0, netoPrevio - bonificacionTrabajo(netoPrevio));
  }
  return Math.max(0, neto - Math.min(Math.max(0, epsv), EPSV_MAX_INDIVIDUAL));
}

// Cuota disponible para absorber deducciones (cuota íntegra general − minoración)
export function cuotaDisponible(ingreso, epsv = 0, tipo = "trabajador") {
  return Math.max(0, cuotaGeneral(baseLiquidableGeneral(ingreso, epsv, tipo)) - MINORACION_CUOTA);
}

// ---- Simulador hipoteca + deducción por vivienda habitual (Bizkaia) ----
// cuotaIntegra admite número (constante) o array por año (para validar contra
// ejemplos oficiales con cuotas variables).
export function simular({
  principal, interes, plazo, metalicoInicial = 0, cuotaIntegra,
  edad = 30, menor36 = false, colectivo23 = false,
  creditoInicial = CREDITO_MAX, excluidoPorBase = false, optimizar = false,
}) {
  const r = interes / 100 / 12;
  const n = Math.max(1, Math.round(plazo * 12));
  const cuota = r > 0 ? (principal * r) / (1 - Math.pow(1 + r, -n)) : principal / n;
  const cuotaDelAnio = (a) =>
    Array.isArray(cuotaIntegra)
      ? cuotaIntegra[Math.min(a - 1, cuotaIntegra.length - 1)]
      : cuotaIntegra;

  let bal = principal;
  let credito = Math.max(0, creditoInicial); // crédito = 36.000 − importes APLICADOS
  let interesTotal = 0;
  let deduccionTotal = 0;
  let extraTotal = 0;
  let pendientes = []; // traslados <36: { importe, caduca }
  const filas = [];
  let anio = 0;

  while (anio < 60) {
    const pendSumIni = pendientes.reduce((s, p) => s + p.importe, 0);
    if (bal <= 0.01 && pendSumIni <= 0.01) break;
    anio++;
    const edadAnio = edad + anio - 1;
    const es36 = menor36 && edadAnio < 36;
    const tipo = es36 || colectivo23 ? 0.23 : 0.18;

    let pagado = 0;
    for (let m = 0; m < 12 && bal > 0.01; m++) {
      const int = bal * r;
      const amort = Math.min(cuota - int, bal);
      bal -= amort;
      interesTotal += int;
      pagado += amort + int;
    }
    let extra = 0;
    if (optimizar && credito > 0.01 && bal > 0.01 && pagado < INVERSION_MAX_ANUAL && !excluidoPorBase) {
      extra = Math.min(INVERSION_MAX_ANUAL - pagado, bal);
      bal -= extra;
      extraTotal += extra;
    }
    const invertido = pagado + extra + (anio === 1 ? metalicoInicial : 0);

    // Si deja de ser <36, los traslados pendientes se pierden (sin consumir crédito)
    if (!es36) pendientes = [];
    pendientes = pendientes.filter((p) => p.caduca >= anio);
    const pendSum = pendientes.reduce((s, p) => s + p.importe, 0);

    // Deducción GENERADA este año: el crédito disponible descuenta lo ya aplicado
    // (implícito en `credito`) y lo que está pendiente de aplicar.
    let generada;
    if (excluidoPorBase) {
      generada = 0;
    } else if (anio === 1 && es36) {
      generada = invertido * tipo; // sin límite de 8.500 € el año de compra
    } else {
      generada = Math.min(invertido, INVERSION_MAX_ANUAL) * tipo;
    }
    generada = Math.min(generada, Math.max(0, credito - pendSum));

    // Aplicación contra la cuota íntegra: primero pendientes más antiguas
    let cuotaDisp = cuotaDelAnio(anio);
    let aplicadaPend = 0;
    for (const p of pendientes) {
      const usa = Math.min(p.importe, cuotaDisp);
      p.importe -= usa;
      cuotaDisp -= usa;
      aplicadaPend += usa;
    }
    pendientes = pendientes.filter((p) => p.importe > 0.01);

    const aplicadaAnio = Math.min(generada, cuotaDisp);
    const noAplicada = generada - aplicadaAnio;
    // Lo no aplicado solo se traslada (5 ejercicios) si se es <36; si no, se pierde
    if (noAplicada > 0.01 && es36) {
      pendientes.push({ importe: noAplicada, caduca: anio + 5 });
    }

    const aplicadaTotal = aplicadaPend + aplicadaAnio;
    credito = Math.max(0, credito - aplicadaTotal); // el crédito lo consume lo APLICADO
    deduccionTotal += aplicadaTotal;

    filas.push({
      anio, invertido, generada, aplicada: aplicadaTotal,
      pendiente: pendientes.reduce((s, p) => s + p.importe, 0),
      credito, saldo: Math.max(0, bal), tipo,
    });
  }

  return {
    cuota, filas, interesTotal, deduccionTotal, extraTotal,
    anios: filas.length, creditoFinal: credito,
  };
}

// ---- Event sourcing: reductor puro y proyección ----
// El estado nunca se muta directamente: es la proyección de un log de eventos
// { id, ts, type, payload }. Reproducir el log desde el estado inicial
// reconstruye exactamente el estado actual (y los perfiles guardan el log).
export function reducirEvento(estado, ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case "CAMPO_FIJADO":
      return { ...estado, [p.campo]: p.valor };

    case "ESTADO_IMPORTADO": // migración de perfiles antiguos (guardaban datos, no eventos)
      return { ...estado, ...p, ventas: p.ventas || [] };

    case "POSICION_ANADIDA":
      return { ...estado, cartera: [...(estado.cartera || []), p] };
    case "POSICION_ACTUALIZADA":
      return { ...estado, cartera: (estado.cartera || []).map((x) =>
        x.id === p.id ? { ...x, [p.campo]: p.valor } : x) };
    case "POSICION_ELIMINADA":
      return { ...estado, cartera: (estado.cartera || []).filter((x) => x.id !== p.id) };

    case "PLAN_EPSV_ANADIDO":
      return { ...estado, epsvPlanes: [...(estado.epsvPlanes || []), p] };
    case "PLAN_EPSV_ACTUALIZADO":
      return { ...estado, epsvPlanes: (estado.epsvPlanes || []).map((x) =>
        x.id === p.id ? { ...x, [p.campo]: p.valor } : x) };
    case "PLAN_EPSV_ELIMINADO":
      return { ...estado, epsvPlanes: (estado.epsvPlanes || []).filter((x) => x.id !== p.id) };

    case "VENTA_REGISTRADA": {
      const cartera = estado.cartera || [];
      const pos = cartera.find((x) => x.id === p.posicionId);
      if (!pos || !(pos.actual > 0)) return estado; // evento sobre posición inexistente: se ignora
      const importe = Math.min(Math.max(0, p.importe), pos.actual);
      if (importe <= 0) return estado;
      const coste = pos.compra * (importe / pos.actual); // coste imputado proporcional
      const venta = {
        id: ev.id, posicionId: pos.id, nombre: pos.nombre, tipo: pos.tipo,
        decisionId: p.decisionId || null,
        elegible: pos.tipo !== "fondo",
        ejercicio: Math.max(1, Math.round(p.ejercicio || 1)),
        importe, coste, ganancia: importe - coste,
      };
      return {
        ...estado,
        cartera: cartera.map((x) => x.id === pos.id
          ? { ...x, actual: x.actual - importe, compra: x.compra - coste } : x),
        ventas: [...(estado.ventas || []), venta],
      };
    }

    case "VENTA_ANULADA": {
      const ventas = estado.ventas || [];
      const v = ventas.find((x) => x.id === p.ventaId);
      if (!v) return estado;
      const cartera = estado.cartera || [];
      const existe = cartera.some((x) => x.id === v.posicionId);
      return {
        ...estado,
        cartera: existe
          ? cartera.map((x) => x.id === v.posicionId
              ? { ...x, actual: x.actual + v.importe, compra: x.compra + v.coste } : x)
          : [...cartera, { id: v.posicionId, nombre: v.nombre, tipo: v.tipo,
              compra: v.coste, actual: v.importe }],
        ventas: ventas.filter((x) => x.id !== p.ventaId),
      };
    }

    default:
      return estado;
  }
}

export const proyectar = (eventos, inicial) =>
  (eventos || []).reduce(reducirEvento, inicial);

// ---- Caso de uso (dominio puro): planificar la desinversión por ejercicios ----
// Devuelve los payloads de VENTA_REGISTRADA: el bloque "general" se vende entero
// en el primer ejercicio; el bloque "3 %" se trocea en tramos < 10.000 €/ejercicio.
export function planificarVentas(posGeneral, pos3pct, anioInicio) {
  const ventas = [];
  const hayGeneral = posGeneral.some((p) => p.actual > 0.01);
  for (const p of posGeneral) {
    if (p.actual > 0.01) ventas.push({ posicionId: p.id, importe: p.actual, ejercicio: anioInicio });
  }
  let ejercicio = hayGeneral ? anioInicio + 1 : anioInicio;
  let hueco = 9999;
  for (const p of pos3pct) {
    let resto = p.actual;
    while (resto > 0.01) {
      const trozo = Math.min(resto, hueco);
      ventas.push({ posicionId: p.id, importe: trozo, ejercicio });
      resto -= trozo;
      hueco -= trozo;
      if (hueco <= 0.01) { ejercicio += 1; hueco = 9999; }
    }
  }
  return ventas;
}

// ---- Liquidación por ejercicio y comparador de regímenes ----
export const LIMITE_3PCT = 10000;

export const impuestoGanancia = (ganancia, otras) =>
  Math.max(0, cuotaAhorro(otras + Math.max(0, ganancia)) - cuotaAhorro(otras));

export function liquidarVentas(ventas, otrasRentas) {
  const m = new Map();
  for (const v of ventas) {
    const e = m.get(v.ejercicio) ||
      { ejercicio: v.ejercicio, vCot: 0, gCot: 0, gFon: 0, lista: [] };
    if (v.elegible) { e.vCot += v.importe; e.gCot += v.ganancia; }
    else { e.gFon += v.ganancia; }
    e.lista.push(v);
    m.set(v.ejercicio, e);
  }
  const filas = [...m.values()].sort((a, b) => a.ejercicio - b.ejercicio).map((e) => {
    const general = impuestoGanancia(Math.max(0, e.gCot + e.gFon), otrasRentas);
    const op3 = e.vCot > 0 && e.vCot < LIMITE_3PCT
      ? e.vCot * 0.03 + impuestoGanancia(Math.max(0, e.gFon), otrasRentas)
      : null;
    const usa3 = op3 !== null && op3 < general;
    return { ...e, general, op3, usa3, pago: usa3 ? op3 : general,
      excede: e.vCot >= LIMITE_3PCT };
  });
  return { filas, total: filas.reduce((s, f) => s + f.pago, 0) };
}
