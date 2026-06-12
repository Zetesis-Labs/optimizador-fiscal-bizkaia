// =============================================================================
//  SUITE DE VALIDACIÓN — Optimizador fiscal foral de Bizkaia
//  Cobertura: 100 % de las funciones exportadas y de los casos de uso.
//
//  Fuentes oficiales de referencia:
//   · NF 13/2013 IRPF Bizkaia (texto consolidado) — escalas, deducciones, DA 24.ª
//   · NF 2/2025 (revisión fiscal) — escala del ahorro 19–28 %, límite 68.000 €
//   · NF 7/2025 (Presupuestos 2026) — tarifa general deflactada, minoración 1.615 €
//   · Guía Gure Gida de la Hacienda Foral (KA-01887) — ejemplo resuelto de vivienda
//   · DA 24.ª NF 13/2013 — gravamen especial del 3 % (< 10.000 €/ejercicio)
//
//  Las cifras marcadas [OFICIAL] se contrastan contra columnas publicadas.
//  Las marcadas [MODELO] validan invariantes de las aproximaciones del motor.
// =============================================================================

import {
  CREDITO_MAX, INVERSION_MAX_ANUAL,
  ESCALA_AHORRO, ESCALA_GENERAL, MINORACION_CUOTA,
  EPSV_MAX_INDIVIDUAL, EPSV_MAX_EMPRESA, EPSV_MAX_CONJUNTO, SS_PCT,
  LIMITE_3PCT,
  cuotaAhorro, cuotaGeneral, bonificacionTrabajo,
  baseLiquidableGeneral, cuotaDisponible, epsvReducible,
  simular, reducirEvento, proyectar, planificarVentas,
  impuestoGanancia, liquidarVentas,
} from "../src/lib/engine.js";

let pass = 0, fail = 0;
const aprox = (a, b, tol = 0.01) => Math.abs(a - b) <= tol;
function S(n) { console.log("\n" + n); }
function check(n, cond, det = "") {
  if (cond) { pass++; console.log("  ✓ " + n); }
  else { fail++; console.log("  ✗ " + n + (det ? " → " + det : "")); }
}
const venta = (importe, ganancia, ejercicio, elegible = true, extra = {}) =>
  ({ id: "v" + Math.random().toString(36).slice(2), importe, ganancia,
     coste: importe - ganancia, ejercicio, elegible, ...extra });

// =============================================================================
S("1 · Constantes normativas [OFICIAL]");
check("Crédito vitalicio de vivienda = 36.000 €", CREDITO_MAX === 36000);
check("Base máxima de inversión deducible = 8.500 €/año", INVERSION_MAX_ANUAL === 8500);
check("Minoración de cuota 2026 = 1.615 € (NF 7/2025)", MINORACION_CUOTA === 1615);
check("Límite EPSV individual = 5.000 €", EPSV_MAX_INDIVIDUAL === 5000);
check("Límite EPSV empresarial = 8.000 €", EPSV_MAX_EMPRESA === 8000);
check("Límite EPSV conjunto = 10.000 €", EPSV_MAX_CONJUNTO === 10000);
check("Umbral regla del 3 % = 10.000 € (DA 24.ª)", LIMITE_3PCT === 10000);
check("Escala del ahorro: 9 escalones", ESCALA_AHORRO.length === 9);
check("Escala general: 8 tramos", ESCALA_GENERAL.length === 8);
check("Tipo mínimo del ahorro 19 %", ESCALA_AHORRO[0].tipo === 0.19);
check("Tipo máximo del ahorro 28 %", ESCALA_AHORRO[ESCALA_AHORRO.length - 1].tipo === 0.28);
check("Tipo mínimo general 23 %", ESCALA_GENERAL[0].tipo === 0.23);
check("Tipo máximo general 49 %", ESCALA_GENERAL[ESCALA_GENERAL.length - 1].tipo === 0.49);

// =============================================================================
S("2 · Escala del ahorro — cuotas acumuladas oficiales [OFICIAL]");
const AHORRO_OFICIAL = [
  [7500, 1425], [15000, 2925], [30000, 6225], [50000, 11025],
  [90000, 21225], [120000, 29025], [240000, 60825], [300000, 77025],
];
for (const [base, cuota] of AHORRO_OFICIAL)
  check("cuotaAhorro(" + base.toLocaleString("es") + ") = " + cuota.toLocaleString("es") + " €",
    aprox(cuotaAhorro(base), cuota), String(cuotaAhorro(base)));
check("Ahorro: base 0 → 0", cuotaAhorro(0) === 0);
check("Ahorro: negativo → 0", cuotaAhorro(-5000) === 0);
check("Ahorro: punto medio 10.000 → 1.925 € (1.425 + 2.500×20 %)", aprox(cuotaAhorro(10000), 1925));
check("Ahorro: punto medio 25.000 → 5.125 € (2.925 + 10.000×22 %)", aprox(cuotaAhorro(25000), 5125));
check("Ahorro: marginal 28 % sobre 500.000", aprox(cuotaAhorro(500000), 77025 + 200000 * 0.28));

// =============================================================================
S("3 · Tarifa general — cuotas acumuladas oficiales [OFICIAL]");
const GENERAL_OFICIAL = [
  [18080, 4158.40], [36160, 9220.80], [54240, 15548.80], [77450, 24832.80],
  [107260, 38247.30], [142960, 54669.30], [208390, 85421.40],
];
for (const [base, cuota] of GENERAL_OFICIAL)
  check("cuotaGeneral(" + base.toLocaleString("es") + ") = " + cuota.toLocaleString("es") + " €",
    aprox(cuotaGeneral(base), cuota), String(cuotaGeneral(base)));
check("General: base 0 → 0", cuotaGeneral(0) === 0);
check("General: negativo → 0", cuotaGeneral(-1000) === 0);
check("General: 50.000 → 14.064,80 € (9.220,80 + 13.840×35 %)", aprox(cuotaGeneral(50000), 14064.80));
check("General: 100.000 → 34.980,30 € (24.832,80 + 22.550×45 %)", aprox(cuotaGeneral(100000), 34980.30));
check("General: marginal 49 % sobre 308.390", aprox(cuotaGeneral(308390), 85421.40 + 100000 * 0.49));
check("General: progresividad estricta", cuotaGeneral(40001) > cuotaGeneral(40000));

// =============================================================================
S("4 · Bonificación de rendimientos de trabajo [MODELO]");
check("Renta ≤ 7.500: bonificación máxima 4.650 €", bonificacionTrabajo(5000) === 4650);
check("Renta exacta 7.500 → 4.650 €", bonificacionTrabajo(7500) === 4650);
check("Tramo decreciente en 11.250 → 3.825 €", aprox(bonificacionTrabajo(11250), 3825));
check("Renta > 15.000: suelo de 3.000 €", bonificacionTrabajo(40000) === 3000);
check("Continuidad en 15.000 → 3.000 €", aprox(bonificacionTrabajo(15000), 3000));
check("La bonificación nunca crece con la renta", bonificacionTrabajo(8000) >= bonificacionTrabajo(20000));

// =============================================================================
S("5 · Base liquidable y cuota disponible — trabajador [MODELO]");
{
  const base = baseLiquidableGeneral(35000, 0, "trabajador");
  check("Bruto 35.000 → base 29.725 € (cotización + bonificación)",
    aprox(base, 35000 * (1 - SS_PCT) - 3000), String(base));
  check("Cuota disponible = cuotaGeneral(base) − 1.615 €",
    aprox(cuotaDisponible(35000, 0, "trabajador"), cuotaGeneral(base) - MINORACION_CUOTA));
  check("Por defecto el tipo es trabajador", aprox(baseLiquidableGeneral(35000), base));
  check("Sueldo 0 → base 0 y cuota 0", baseLiquidableGeneral(0) === 0 && cuotaDisponible(0) === 0);
  check("EPSV reduce la base euro a euro (5.000)", aprox(baseLiquidableGeneral(35000, 5000), base - 5000));
  check("EPSV por encima de 5.000 no reduce más", aprox(baseLiquidableGeneral(35000, 9000), base - 5000));
}

// =============================================================================
S("6 · Base liquidable y cuota disponible — autónomo [MODELO]");
check("Autónomo: base = rendimiento neto", aprox(baseLiquidableGeneral(30000, 0, "autonomo"), 30000));
check("Autónomo: EPSV reduce euro a euro", aprox(baseLiquidableGeneral(30000, 5000, "autonomo"), 25000));
check("Autónomo paga más que trabajador con igual importe",
  baseLiquidableGeneral(30000, 0, "autonomo") > baseLiquidableGeneral(30000, 0, "trabajador"));
check("Autónomo: cuota disponible coherente",
  aprox(cuotaDisponible(30000, 0, "autonomo"), cuotaGeneral(30000) - MINORACION_CUOTA));
check("Autónomo: rendimiento 0 → base 0", baseLiquidableGeneral(0, 0, "autonomo") === 0);

// =============================================================================
S("7 · Límites de aportación EPSV [OFICIAL]");
check("Sin empresa: reducible min(aportación, 5.000)", aprox(epsvReducible(7000, 0), 5000));
check("Aportación por debajo del tope se respeta", aprox(epsvReducible(3000, 0), 3000));
check("Empresa 3.000 + individual 5.000 → 5.000 (≤ 10.000)", aprox(epsvReducible(5000, 3000), 5000));
check("Empresa 8.000 → individual reducible solo 2.000", aprox(epsvReducible(5000, 8000), 2000));
check("Empresa > 8.000 computa como 8.000", aprox(epsvReducible(5000, 12000), 2000));
check("Empresa 10.000 (topada a 8.000) deja 2.000 de margen individual", aprox(epsvReducible(5000, 10000), 2000));
check("Margen individual nulo solo si la empresa agota el conjunto vía tope (8.000+ind: 5.000→cabe 2.000)", aprox(epsvReducible(2000, 8000), 2000));
check("Exceso trasladable = aportación − reducible", aprox(5000 - epsvReducible(5000, 8000), 3000));
check("Aportación negativa → 0", epsvReducible(-1000, 0) === 0);

// =============================================================================
S("8 · Deducción de vivienda — EJEMPLO OFICIAL DFB 'Kepa' (KA-01887) [OFICIAL]");
{
  const r = simular({ principal: 150000, interes: 0, plazo: 25, metalicoInicial: 100000,
    cuotaIntegra: [8000, 9000, 10000, 12000], edad: 32, menor36: true });
  const f = r.filas;
  check("Año 1: generada 24.380 €", aprox(f[0].generada, 24380), String(f[0].generada));
  check("Año 1: aplicada 8.000 € (techo de cuota)", aprox(f[0].aplicada, 8000));
  check("Año 1: pendiente 16.380 €", aprox(f[0].pendiente, 16380), String(f[0].pendiente));
  check("Año 2: aplicada 9.000 €", aprox(f[1].aplicada, 9000));
  check("Año 2: pendiente 8.760 € (7.380 + 1.380)", aprox(f[1].pendiente, 8760), String(f[1].pendiente));
  check("Año 3: aplicada 10.000 €", aprox(f[2].aplicada, 10000));
  check("Año 3: pendiente 140 €", aprox(f[2].pendiente, 140), String(f[2].pendiente));
  check("Año 4: aplicada 1.520 € (140 + 1.380)", aprox(f[3].aplicada, 1520), String(f[3].aplicada));
  check("Año 4: pendiente 0 €", aprox(f[3].pendiente, 0));
}

// =============================================================================
S("9 · Deducción de vivienda — régimen general 18 % [OFICIAL]");
{
  const r = simular({ principal: 200000, interes: 3, plazo: 20, cuotaIntegra: 500, edad: 45 });
  const f = r.filas[0];
  check("Tipo 18 % para el régimen general", f.tipo === 0.18);
  check("Generada = min(invertido, 8.500) × 18 % = 1.530 €", aprox(f.generada, 1530), String(f.generada));
  check("Aplicada limitada a la cuota (500 €)", aprox(f.aplicada, 500));
  check("Sin traslados (pendiente 0)", aprox(f.pendiente, 0));
  check("El crédito solo consume lo aplicado (36.000 − 500)", aprox(f.credito, 35500));
}

// =============================================================================
S("10 · Deducción de vivienda — colectivo del 23 % con tope 1.955 € [OFICIAL]");
{
  const r = simular({ principal: 200000, interes: 3, plazo: 25, cuotaIntegra: 99999, edad: 45, colectivo23: true });
  const f = r.filas[0];
  check("Tipo 23 % para el colectivo", f.tipo === 0.23);
  check("Sí aplica el tope de 8.500 €: generada = 1.955 €",
    aprox(f.generada, 8500 * 0.23) && aprox(f.generada, 1955), String(f.generada));
  check("Sin traslados (solo <36 trasladan)", aprox(f.pendiente, 0));
}

// =============================================================================
S("11 · Deducción de vivienda — menor de 36: sin tope el año de compra [OFICIAL]");
{
  const r = simular({ principal: 100000, interes: 3, plazo: 20, metalicoInicial: 40000,
    cuotaIntegra: 99999, edad: 30, menor36: true });
  const f = r.filas[0];
  check("Año de compra <36: tipo 23 %", f.tipo === 0.23);
  check("Año de compra <36: NO aplica el tope (generada > 1.955 €)", f.generada > 1955, String(f.generada));
}

// =============================================================================
S("12 · Deducción de vivienda — cambio de tipo y caducidad de traslados [OFICIAL]");
{
  const r = simular({ principal: 100000, interes: 2, plazo: 20, metalicoInicial: 80000,
    cuotaIntegra: 3000, edad: 34, menor36: true });
  const f = r.filas;
  check("Año 1 (34): tipo 23 %", f[0].tipo === 0.23);
  check("Año 2 (35): tipo 23 %", f[1].tipo === 0.23);
  check("Año 3 (36): tipo 18 %", f[2].tipo === 0.18);
  check("Año 2: hay pendiente", f[1].pendiente > 0);
  check("Año 3: el pendiente se pierde al cumplir 36", aprox(f[2].pendiente, 0));
  const ap = f.reduce((s, x) => s + x.aplicada, 0);
  check("Crédito = 36.000 − Σ aplicado (lo perdido no consume)",
    aprox(r.creditoFinal, CREDITO_MAX - ap), r.creditoFinal + " vs " + (CREDITO_MAX - ap));
}

// =============================================================================
S("13 · Deducción de vivienda — crédito vitalicio y reinversión [OFICIAL]");
{
  const ci = CREDITO_MAX - 0.18 * 50000 - 20000; // 7.000
  const r = simular({ principal: 300000, interes: 3, plazo: 30, cuotaIntegra: 99999, edad: 45, creditoInicial: ci, optimizar: true });
  check("Crédito inicial = 36.000 − 18 %×50.000 − 20.000 = 7.000 €", aprox(ci, 7000));
  check("Σ deducciones ≤ crédito disponible", r.deduccionTotal <= ci + 0.01);
  check("El crédito se agota (final 0)", aprox(r.creditoFinal, 0));
}

// =============================================================================
S("14 · Deducción de vivienda — exclusión por base ≥ 68.000 € [OFICIAL]");
{
  const r = simular({ principal: 200000, interes: 3, plazo: 25, cuotaIntegra: 99999, edad: 30, menor36: true, excluidoPorBase: true });
  check("Excluido: deducción total 0", aprox(r.deduccionTotal, 0));
  check("Excluido: crédito intacto (36.000 €)", aprox(r.creditoFinal, CREDITO_MAX));
}

// =============================================================================
S("15 · Deducción de vivienda — efecto de la optimización [MODELO]");
{
  const base = { principal: 200000, interes: 3, plazo: 30, cuotaIntegra: 99999, edad: 45 };
  const n = simular({ ...base, optimizar: false }), o = simular({ ...base, optimizar: true });
  check("Optimizar deduce ≥ que no optimizar", o.deduccionTotal >= n.deduccionTotal - 0.01);
  check("Optimizar reduce los intereses", o.interesTotal <= n.interesTotal + 0.01);
  check("Optimizar acorta o iguala la vida del préstamo", o.anios <= n.anios);
}

// =============================================================================
S("16 · Reductor — CAMPO_FIJADO y ESTADO_IMPORTADO [casos de uso]");
{
  check("CAMPO_FIJADO fija el escalar",
    reducirEvento({ a: 1 }, { type: "CAMPO_FIJADO", payload: { campo: "a", valor: 9 } }).a === 9);
  const s2 = reducirEvento({ a: 1 }, { type: "CAMPO_FIJADO", payload: { campo: "b", valor: 2 } });
  check("CAMPO_FIJADO no toca el resto", s2.a === 1 && s2.b === 2);
  const s3 = reducirEvento({ x: 1 }, { type: "ESTADO_IMPORTADO", payload: { x: 5 } });
  check("ESTADO_IMPORTADO fusiona el snapshot", s3.x === 5);
  check("ESTADO_IMPORTADO garantiza ventas = []", Array.isArray(s3.ventas));
  check("Evento desconocido devuelve el estado intacto",
    reducirEvento({ a: 1 }, { type: "ZZZ", payload: {} }).a === 1);
}

// =============================================================================
S("17 · Reductor — cartera (añadir/actualizar/eliminar) [casos de uso]");
{
  let s = { cartera: [] };
  s = reducirEvento(s, { type: "POSICION_ANADIDA", payload: { id: 1, nombre: "A", actual: 100 } });
  check("POSICION_ANADIDA inserta", s.cartera.length === 1 && s.cartera[0].nombre === "A");
  s = reducirEvento(s, { type: "POSICION_ACTUALIZADA", payload: { id: 1, campo: "actual", valor: 250 } });
  check("POSICION_ACTUALIZADA modifica el campo", s.cartera[0].actual === 250);
  s = reducirEvento(s, { type: "POSICION_ACTUALIZADA", payload: { id: 99, campo: "actual", valor: 0 } });
  check("POSICION_ACTUALIZADA sobre id inexistente no rompe", s.cartera[0].actual === 250);
  s = reducirEvento(s, { type: "POSICION_ELIMINADA", payload: { id: 1 } });
  check("POSICION_ELIMINADA quita la posición", s.cartera.length === 0);
}

// =============================================================================
S("18 · Reductor — planes EPSV (añadir/actualizar/eliminar) [casos de uso]");
{
  let s = { epsvPlanes: [] };
  s = reducirEvento(s, { type: "PLAN_EPSV_ANADIDO", payload: { id: 1, nombre: "EPSV", aportado: 1000 } });
  check("PLAN_EPSV_ANADIDO inserta", s.epsvPlanes.length === 1);
  s = reducirEvento(s, { type: "PLAN_EPSV_ACTUALIZADO", payload: { id: 1, campo: "derechos", valor: 1500 } });
  check("PLAN_EPSV_ACTUALIZADO modifica", s.epsvPlanes[0].derechos === 1500);
  s = reducirEvento(s, { type: "PLAN_EPSV_ELIMINADO", payload: { id: 1 } });
  check("PLAN_EPSV_ELIMINADO quita", s.epsvPlanes.length === 0);
}

// =============================================================================
S("19 · Reductor — VENTA_REGISTRADA (coste proporcional) [casos de uso]");
{
  const INI = { cartera: [{ id: 1, nombre: "ACME", tipo: "accion", compra: 1000, actual: 4000 }], ventas: [] };
  const s = reducirEvento(INI, { id: "e1", type: "VENTA_REGISTRADA", payload: { posicionId: 1, importe: 2000, ejercicio: 2026 } });
  check("Coste imputado proporcional (2.000×25 % = 500)", aprox(s.ventas[0].coste, 500));
  check("Ganancia 1.500 €", aprox(s.ventas[0].ganancia, 1500));
  check("La posición baja a 2.000 / 500", aprox(s.cartera[0].actual, 2000) && aprox(s.cartera[0].compra, 500));
  check("Acción → elegible para el 3 %", s.ventas[0].elegible === true);
  const F = { cartera: [{ id: 2, nombre: "Fondo", tipo: "fondo", compra: 5000, actual: 8000 }], ventas: [] };
  check("Fondo → elegible = false",
    reducirEvento(F, { id: "f1", type: "VENTA_REGISTRADA", payload: { posicionId: 2, importe: 8000, ejercicio: 2026 } }).ventas[0].elegible === false);
  check("Sobreventa se limita al saldo (4.000)",
    aprox(reducirEvento(INI, { id: "e2", type: "VENTA_REGISTRADA", payload: { posicionId: 1, importe: 9999, ejercicio: 2026 } }).ventas[0].importe, 4000));
  check("Venta sobre posición inexistente se ignora",
    reducirEvento(INI, { id: "e3", type: "VENTA_REGISTRADA", payload: { posicionId: 77, importe: 100, ejercicio: 2026 } }).ventas.length === 0);
  check("La venta conserva su decisionId",
    reducirEvento(INI, { id: "e4", type: "VENTA_REGISTRADA", payload: { posicionId: 1, importe: 1000, ejercicio: 2026, decisionId: "D1" } }).ventas[0].decisionId === "D1");
}

// =============================================================================
S("20 · Reductor — VENTA_ANULADA (evento compensatorio) [casos de uso]");
{
  const INI = { cartera: [{ id: 1, nombre: "ACME", tipo: "accion", compra: 1000, actual: 4000 }], ventas: [] };
  const evs = [{ id: "e1", type: "VENTA_REGISTRADA", payload: { posicionId: 1, importe: 2000, ejercicio: 2026 } }];
  const s2 = proyectar([...evs, { id: "c1", type: "VENTA_ANULADA", payload: { ventaId: "e1" } }], INI);
  check("Anular restaura la posición exacta (4.000 / 1.000)", aprox(s2.cartera[0].actual, 4000) && aprox(s2.cartera[0].compra, 1000));
  check("Anular elimina la venta del proyectado", s2.ventas.length === 0);
  const evs2 = [...evs, { id: "d1", type: "POSICION_ELIMINADA", payload: { id: 1 } }];
  const s3 = proyectar([...evs2, { id: "c2", type: "VENTA_ANULADA", payload: { ventaId: "e1" } }], INI);
  check("Anular reconstruye la posición si se había eliminado",
    s3.cartera.some((p) => p.id === 1) && aprox(s3.cartera.find((p) => p.id === 1).actual, 2000));
  check("Anular venta inexistente no rompe",
    proyectar([{ id: "c3", type: "VENTA_ANULADA", payload: { ventaId: "zzz" } }], INI).ventas.length === 0);
}

// =============================================================================
S("21 · Proyección — determinismo e idempotencia [casos de uso]");
{
  const INI = { sueldoBruto: 30000, cartera: [{ id: 1, nombre: "A", tipo: "accion", compra: 1000, actual: 4000 }], ventas: [] };
  const evs = [
    { id: "1", type: "CAMPO_FIJADO", payload: { campo: "sueldoBruto", valor: 42000 } },
    { id: "2", type: "VENTA_REGISTRADA", payload: { posicionId: 1, importe: 2000, ejercicio: 2026 } },
  ];
  const a = proyectar(evs, INI), b = proyectar(evs, INI);
  check("Re-proyectar da estados idénticos", JSON.stringify(a) === JSON.stringify(b));
  check("Proyección de log vacío = estado inicial", JSON.stringify(proyectar([], INI)) === JSON.stringify(INI));
  check("Aplica los eventos en orden (sueldo 42.000)", a.sueldoBruto === 42000);
}

// =============================================================================
S("22 · Caso de uso — planificarVentas (ejercicios reales, tramos < 10.000) [OFICIAL]");
{
  const plan = planificarVentas([{ id: "g", actual: 9000 }], [{ id: "a", actual: 16000 }, { id: "b", actual: 5000 }], 2026);
  check("El bloque general se vende en 2026", plan[0].ejercicio === 2026 && aprox(plan[0].importe, 9000));
  const porAnio = {};
  for (const v of plan.filter((x) => x.posicionId !== "g")) porAnio[v.ejercicio] = (porAnio[v.ejercicio] || 0) + v.importe;
  check("Cada ejercicio del 3 % < 10.000 €", Object.values(porAnio).every((s) => s < 10000), JSON.stringify(porAnio));
  check("El total troceado conserva el importe (21.000 €)", aprox(Object.values(porAnio).reduce((s, x) => s + x, 0), 21000));
  check("El 3 % arranca el año siguiente al general (2027)", Math.min(...Object.keys(porAnio).map(Number)) === 2027);
  check("Sin bloque general, el 3 % arranca en el año de inicio",
    planificarVentas([], [{ id: "a", actual: 5000 }], 2026)[0].ejercicio === 2026);
  const INI = { cartera: [
    { id: "g", nombre: "G", tipo: "fondo", compra: 9000, actual: 9000 },
    { id: "a", nombre: "A", tipo: "accion", compra: 4000, actual: 16000 },
    { id: "b", nombre: "B", tipo: "accion", compra: 1000, actual: 5000 },
  ], ventas: [] };
  const evs = plan.map((p, i) => ({ id: "p" + i, type: "VENTA_REGISTRADA", payload: { ...p, decisionId: "D1" } }));
  const s = proyectar(evs, INI);
  check("El plan agota la cartera al reproducirlo", s.cartera.every((x) => x.actual < 0.01));
  const comp = s.ventas.map((v, i) => ({ id: "c" + i, type: "VENTA_ANULADA", payload: { ventaId: v.id } }));
  const s2 = proyectar([...evs, ...comp], INI);
  check("Compensar la decisión restaura la cartera al céntimo",
    aprox(s2.cartera.find((x) => x.id === "a").actual, 16000) && aprox(s2.cartera.find((x) => x.id === "a").compra, 4000) && s2.ventas.length === 0);
}

// =============================================================================
S("23 · impuestoGanancia — coherencia con la escala del ahorro [OFICIAL]");
check("Ganancia sobre base 0 = cuotaAhorro(ganancia)", aprox(impuestoGanancia(10000, 0), cuotaAhorro(10000)));
check("Es el impuesto MARGINAL sobre otras rentas",
  aprox(impuestoGanancia(5000, 20000), cuotaAhorro(25000) - cuotaAhorro(20000)));
check("Ganancia negativa o nula → 0", impuestoGanancia(-3000, 10000) === 0);
check("Aditividad de tramos", aprox(impuestoGanancia(5000, 0) + impuestoGanancia(5000, 5000), impuestoGanancia(10000, 0)));

// =============================================================================
S("24 · liquidarVentas — frontera del límite y régimen óptimo [OFICIAL]");
{
  const a = liquidarVentas([venta(9999, 9000, 2026)], 0).filas[0];
  check("9.999 €: opción del 3 % disponible (no excede)", a.op3 !== null && !a.excede);
  check("9.999 € con plusvalía alta: opta al 3 %, paga 299,97 €", a.usa3 && aprox(a.pago, 9999 * 0.03));
  check("9.999 €: el comparador ahorra (general > 3 %)", a.general - a.op3 > 0);
  const b = liquidarVentas([venta(10000, 9000, 2026)], 0).filas[0];
  check("10.000 € exactos: se pierde el 3 % (excede, op3 nulo)", b.excede && b.op3 === null);
  check("10.000 € exactos: tributa por el general", aprox(b.pago, b.general));
  const c = liquidarVentas([venta(9000, 500, 2026)], 0).filas[0];
  check("Plusvalía baja: el general gana al 3 %", !c.usa3 && c.pago === c.general);
  const d = liquidarVentas([venta(6000, 3000, 2026), venta(4001, 2000, 2026)], 0).filas[0];
  check("6.000 + 4.001 = 10.001 en cotizados → pierde el 3 %", d.excede);
  const e = liquidarVentas([venta(9000, 4000, 2026), venta(20000, 1000, 2026, false)], 0).filas[0];
  check("Un fondo de 20.000 € no rompe el límite de cotizados", !e.excede && e.op3 !== null, "vCot=" + e.vCot);
  check("Pero el fondo sí suma al impuesto general", e.gFon === 1000);
}

// =============================================================================
S("25 · liquidarVentas — multi-ejercicio, compensación y umbral [OFICIAL]");
{
  const liq = liquidarVentas([venta(9000, 500, 2026), venta(9999, 9000, 2027), venta(9999, 9000, 2028)], 0);
  check("Se agrupan 3 ejercicios distintos", liq.filas.length === 3);
  check("2026 general; 2027 y 2028 al 3 %", !liq.filas[0].usa3 && liq.filas[1].usa3 && liq.filas[2].usa3);
  check("Total = suma de óptimos por ejercicio", aprox(liq.total, liq.filas.reduce((s, f) => s + f.pago, 0)));
  const comp = liquidarVentas([venta(5000, 3000, 2026), venta(4000, -2000, 2026)], 0).filas[0];
  check("Pérdidas compensan ganancias del año (neto 1.000)", aprox(comp.general, cuotaAhorro(1000)), String(comp.general));
  const ratio = 0.03 / 0.19;
  const justo = liquidarVentas([venta(9999, Math.round(9999 * ratio), 2026)], 0).filas[0];
  check("En el umbral (~15,8 %) general y 3 % casi empatan", Math.abs(justo.general - justo.op3) < 5, justo.general + " vs " + justo.op3);
  check("Ejercicio sin ventas → liquidación vacía", liquidarVentas([], 0).filas.length === 0);
}

// =============================================================================
S("26 · Flujo extremo a extremo — cartera → plan → liquidación [casos de uso]");
{
  const INI = { cartera: [
    { id: "a", nombre: "Acción top", tipo: "accion", compra: 4000, actual: 16000 },
    { id: "b", nombre: "Fondo", tipo: "fondo", compra: 10000, actual: 9000 },
    { id: "c", nombre: "ETF", tipo: "etf", compra: 5000, actual: 5500 },
  ], ventas: [] };
  const general = [INI.cartera[1], INI.cartera[2]];
  const tres = [INI.cartera[0]];
  const plan = planificarVentas(general, tres, 2026);
  const evs = plan.map((p, i) => ({ id: "P" + i, type: "VENTA_REGISTRADA", payload: { ...p, decisionId: "PLAN" } }));
  const s = proyectar(evs, INI);
  const liq = liquidarVentas(s.ventas, 0);
  check("La cartera queda agotada tras el plan", s.cartera.every((p) => p.actual < 0.01));
  check("Ningún ejercicio supera el límite", liq.filas.every((f) => !f.excede), JSON.stringify(liq.filas.map((f) => f.vCot)));
  check("2026 liquida fondo+ETF por general", liq.filas[0].ejercicio === 2026 && !liq.filas[0].usa3);
  check("Deshacer el plan revierte a la cartera original", (() => {
    const comp = s.ventas.map((v, i) => ({ id: "Z" + i, type: "VENTA_ANULADA", payload: { ventaId: v.id } }));
    const r = proyectar([...evs, ...comp], INI);
    return aprox(r.cartera.find((p) => p.id === "a").actual, 16000) && r.ventas.length === 0;
  })());
}

console.log("\n" + "─".repeat(54));
console.log("RESULTADO: " + pass + " OK, " + fail + " fallos  (" +
  Math.round((pass / (pass + fail)) * 100) + "% verde)");
console.log("─".repeat(54));
process.exit(fail ? 1 : 0);
