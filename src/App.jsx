import { useEffect, useMemo, useState } from "react";
import { storage } from "@/lib/storage";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";

const CREDITO_MAX = 36000;
const INVERSION_MAX_ANUAL = 8500;

const eur = (n) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur2 = (n) =>
  n.toLocaleString("es-ES", { style: "currency", currency: "EUR", maximumFractionDigits: 2 });

// Elemento firma: el crédito vitalicio como depósito que se va consumiendo
const DepositoForal = ({ disponible }) => {
  const usado = Math.max(0, CREDITO_MAX - disponible);
  const pct = Math.max(0, Math.min(100, (disponible / CREDITO_MAX) * 100));
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
          Depósito foral · crédito vitalicio
        </p>
        <p className="font-display num text-lg font-semibold text-emerald-950">
          {eur(disponible)}{" "}
          <span className="text-xs font-normal text-stone-500">de {eur(CREDITO_MAX)}</span>
        </p>
      </div>
      <div className="relative mt-1 h-4 overflow-hidden rounded-full border border-emerald-900/15 bg-stone-200/80">
        <div className="gauge h-full rounded-full" style={{ width: pct + "%" }} />
        {[1, 2, 3].map((i) => (
          <span key={i} className="absolute top-0 h-full w-px bg-white/70" style={{ left: i * 25 + "%" }} />
        ))}
      </div>
      {usado > 0.5 && (
        <p className="mt-0.5 text-[11px] text-stone-500">{eur(usado)} ya consumidos o minorados</p>
      )}
    </div>
  );
};

/* ---------- UI básica propia (sin dependencias extra) ---------- */

const Switch = ({ id, checked, onCheckedChange }) => (
  <button
    id={id}
    type="button"
    role="switch"
    aria-checked={checked}
    onClick={() => onCheckedChange(!checked)}
    className={
      "relative h-6 w-11 shrink-0 rounded-full transition-colors " +
      (checked ? "bg-emerald-700" : "bg-stone-300")
    }
  >
    <span
      className={
        "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all " +
        (checked ? "left-[22px]" : "left-0.5")
      }
    />
  </button>
);



// ---------- Estado compartido y perfiles ----------
const CLAVE_PERFILES = "bizkaia-fiscal-perfiles";
const DEFAULTS = {
  // Hipoteca
  prestamo: 180000, interes: 2.8, plazo: 30, metalicoInicial: 0,
  // Fiscal
  edad: 30, menor36: false, colectivo23: false,
  sueldoBruto: 35000, epsv: 0, epsvEmpresa: 0, baseAhorro: 0,
  creditoConsumido: 0, gananciaExenta: 0, compraDesde2026: true,
  // Desinversión
  valorVenta: 60000, valorCompra: 20000, otrasRentas: 0, cotizados: true,
  // Perfil
  tipoContribuyente: "autonomo", // "trabajador" | "autonomo" | "sl" (próximamente)
  // Carteras
  cartera: [
    { id: 1, nombre: "Acciones (p. ej. Iberdrola)", tipo: "accion", compra: 5000, actual: 12000 },
    { id: 2, nombre: "ETF MSCI World", tipo: "etf", compra: 15000, actual: 22000 },
    { id: 3, nombre: "Fondo indexado", tipo: "fondo", compra: 10000, actual: 9000 },
  ],
  epsvPlanes: [{ id: 1, nombre: "EPSV individual", aportado: 20000, derechos: 28000 }],
};

// ---- Tarifa general 2026 (NF 7/2025, deflactada 2 %) ----
const ESCALA_GENERAL = [
  { hasta: 18080, tipo: 0.23 },
  { hasta: 36160, tipo: 0.28 },
  { hasta: 54240, tipo: 0.35 },
  { hasta: 77450, tipo: 0.40 },
  { hasta: 107260, tipo: 0.45 },
  { hasta: 142960, tipo: 0.46 },
  { hasta: 208390, tipo: 0.47 },
  { hasta: Infinity, tipo: 0.49 },
];
const MINORACION_CUOTA = 1615; // por declaración (2026)
const EPSV_MAX_INDIVIDUAL = 5000; // límite anual de aportación individual reducible
const EPSV_MAX_EMPRESA = 8000; // límite de contribuciones empresariales
const EPSV_MAX_CONJUNTO = 10000; // límite conjunto individual + empresarial

// Aportación individual reducible en base, respetando el límite conjunto
// (la contribución empresarial se imputa y reduce, neutra dentro de sus límites)
function epsvReducible(individual, empresa = 0) {
  const emp = Math.min(Math.max(0, empresa), EPSV_MAX_EMPRESA);
  return Math.min(
    Math.max(0, individual),
    EPSV_MAX_INDIVIDUAL,
    Math.max(0, EPSV_MAX_CONJUNTO - emp)
  );
}
const SS_PCT = 0.065; // cotizaciones del trabajador aprox. (incl. MEI)

function cuotaGeneral(base) {
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
function bonificacionTrabajo(netoPrevio) {
  if (netoPrevio <= 7500) return 4650;
  if (netoPrevio <= 15000) return 4650 - 0.22 * (netoPrevio - 7500);
  return 3000;
}

// Ingresos → base liquidable general según tipo de contribuyente:
// "trabajador": sueldo bruto − cotizaciones (~6,5 %) − bonificación de trabajo
// "autonomo": rendimiento neto de la actividad (ingresos − gastos, incl. cuota RETA),
//             sin bonificación de trabajo
function baseLiquidableGeneral(ingreso, epsv = 0, tipo = "trabajador") {
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
function cuotaDisponible(ingreso, epsv = 0, tipo = "trabajador") {
  return Math.max(0, cuotaGeneral(baseLiquidableGeneral(ingreso, epsv, tipo)) - MINORACION_CUOTA);
}

// ---- Event sourcing: reductor puro y proyección ----
// El estado nunca se muta directamente: es la proyección de un log de eventos
// { id, ts, type, payload }. Reproducir el log desde el estado inicial
// reconstruye exactamente el estado actual (y los perfiles guardan el log).
function reducirEvento(estado, ev) {
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

const proyectar = (eventos, inicial) =>
  (eventos || []).reduce(reducirEvento, inicial);

// ---- Caso de uso (dominio puro): planificar la desinversión por ejercicios ----
// Devuelve los payloads de VENTA_REGISTRADA: el bloque "general" se vende entero
// en el primer ejercicio; el bloque "3 %" se trocea en tramos < 10.000 €/ejercicio.
function planificarVentas(posGeneral, pos3pct, anioInicio) {
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

const ANIO_ACTUAL = 2026;
const ESTADO_INICIAL = { ...DEFAULTS, ventas: [] };
const nuevoId = () => Date.now() + "-" + Math.random().toString(36).slice(2, 8);

function resumirEvento(ev) {
  const p = ev.payload || {};
  switch (ev.type) {
    case "CAMPO_FIJADO": return "Campo «" + p.campo + "» → " + String(p.valor);
    case "POSICION_ANADIDA": return "Posición añadida: " + (p.nombre || "");
    case "POSICION_ACTUALIZADA": return "Posición " + p.id + ": " + p.campo + " → " + String(p.valor);
    case "POSICION_ELIMINADA": return "Posición eliminada";
    case "PLAN_EPSV_ANADIDO": return "Plan EPSV añadido: " + (p.nombre || "");
    case "PLAN_EPSV_ACTUALIZADO": return "Plan EPSV: " + p.campo + " → " + String(p.valor);
    case "PLAN_EPSV_ELIMINADO": return "Plan EPSV eliminado";
    case "VENTA_REGISTRADA": return (p.decisionId ? "Plan · " : "") + "Venta registrada: " + eur(p.importe || 0) + " (ejercicio " + (p.ejercicio || ANIO_ACTUAL) + ")";
    case "VENTA_ANULADA": return "Venta anulada";
    case "ESTADO_IMPORTADO": return "Perfil importado (formato antiguo)";
    default: return ev.type;
  }
}

/* ---------- Simulación de hipoteca + crédito fiscal ---------- */
// Motor validado contra el ejemplo oficial de la Hacienda Foral de Bizkaia
// (guía Gure Gida, caso "menor de 36 con traslados") y 29 comprobaciones más.

function simular({
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

/* ---------- Calculadora hipoteca ---------- */

function Calculadora({ datos, upd }) {
  const {
    prestamo, interes, plazo, metalicoInicial,
    edad, menor36, colectivo23, sueldoBruto, epsv, baseAhorro,
    creditoConsumido, gananciaExenta, compraDesde2026,
  } = datos;

  const num = (key) => (e) => {
    const v = Number(e.target.value);
    upd(key, Number.isFinite(v) ? Math.max(0, v) : 0);
  };

  const tipoC = datos.tipoContribuyente || "trabajador";
  const res = useMemo(() => {
    const epsvAplicada = epsvReducible(epsv, datos.epsvEmpresa);
    const baseGeneral = baseLiquidableGeneral(sueldoBruto, epsvAplicada, tipoC);
    const cuotaDisp = cuotaDisponible(sueldoBruto, epsvAplicada, tipoC);
    const excluidoPorBase = compraDesde2026 && (baseGeneral >= 68000 || baseAhorro >= 68000);
    const creditoInicial = Math.max(0, CREDITO_MAX - 0.18 * gananciaExenta - creditoConsumido);

    const base = {
      principal: prestamo, interes, plazo, metalicoInicial, cuotaIntegra: cuotaDisp,
      edad, menor36, colectivo23, creditoInicial, excluidoPorBase,
    };
    const normal = simular({ ...base, optimizar: false });
    const optimo = simular({ ...base, optimizar: true });

    // Jugada EPSV: ¿una aportación (≤5.000 €) bajaría la base general de 68.000 €?
    let jugadaEpsv = null;
    if (compraDesde2026 && baseAhorro < 68000) {
      const baseSinEpsv = baseLiquidableGeneral(sueldoBruto, 0, tipoC);
      const margenEpsv = epsvReducible(EPSV_MAX_INDIVIDUAL, datos.epsvEmpresa);
      if (baseSinEpsv >= 68000 && baseSinEpsv - margenEpsv < 68000) {
        const necesario = Math.ceil(baseSinEpsv - 67999);
        const ahorroIrpf =
          cuotaGeneral(baseSinEpsv) - cuotaGeneral(baseSinEpsv - necesario);
        // Deducción de vivienda que se recupera (1er año, escenario optimizado)
        const conDed = simular({ ...base, excluidoPorBase: false, optimizar: true });
        jugadaEpsv = {
          necesario,
          ahorroIrpf,
          dedRecuperada: conDed.filas[0] ? conDed.filas[0].aplicada : 0,
          activada: epsvAplicada >= necesario,
        };
      }
    }

    return {
      baseGeneral, cuotaDisp, excluidoPorBase, creditoInicial,
      normal, optimo, jugadaEpsv,
      ahorroEpsvMarginal:
        epsvAplicada > 0
          ? cuotaGeneral(baseLiquidableGeneral(sueldoBruto, 0, tipoC)) - cuotaGeneral(baseGeneral)
          : 0,
      interesAhorrado: normal.interesTotal - optimo.interesTotal,
      deduccionExtra: optimo.deduccionTotal - normal.deduccionTotal,
    };
  }, [prestamo, interes, plazo, metalicoInicial, edad, menor36, colectivo23, sueldoBruto,
      epsv, datos.epsvEmpresa, baseAhorro, creditoConsumido, gananciaExenta, compraDesde2026, tipoC]);

  const beneficioOptimizar = res.interesAhorrado + res.deduccionExtra;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Tu hipoteca</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="pre">Préstamo (€)</Label>
              <Input id="pre" type="number" value={prestamo} onChange={num("prestamo")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="met">Metálico en el año de compra (€)</Label>
              <Input id="met" type="number" value={metalicoInicial} onChange={num("metalicoInicial")} />
              <p className="text-xs text-stone-500">
                Entrada y gastos pagados sin préstamo ni cuenta vivienda ya deducida
              </p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="int">Interés (% TIN)</Label>
              <Input id="int" type="number" step="0.1" value={interes} onChange={num("interes")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="pla">Plazo (años)</Label>
              <Input id="pla" type="number" value={plazo} onChange={num("plazo")} />
            </div>
          </div>
          <p className="text-sm text-stone-600">
            Cuota mensual: <strong className="text-emerald-950">{eur2(res.normal.cuota)}</strong> ·
            pago anual aprox.: <strong>{eur(res.normal.cuota * 12)}</strong>
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Tu situación fiscal (Bizkaia)</CardTitle>
          <CardDescription>
            {tipoC === "autonomo"
              ? "Como autónomo, con tu rendimiento neto calculamos la base liquidable y tu cuota con la tarifa de 2026 (minoración de 1.615 €)."
              : "Con tu sueldo bruto calculamos la base liquidable y tu cuota con la tarifa de 2026 (cotizaciones aprox. 6,5 %, bonificación de trabajo y minoración de 1.615 €)."}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="sb">{tipoC === "autonomo" ? "Rendimiento neto anual (€)" : "Sueldo bruto anual (€)"}</Label>
              <Input id="sb" type="number" value={sueldoBruto} onChange={num("sueldoBruto")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="ep">Aportación EPSV anual (€)</Label>
              <Input id="ep" type="number" value={epsv} onChange={num("epsv")} />
              <p className="text-xs text-stone-500">Reduce la base (máx. 5.000 €)</p>
            </div>
            <div className="space-y-1">
              <Label htmlFor="ba">Base del ahorro (€)</Label>
              <Input id="ba" type="number" value={baseAhorro} onChange={num("baseAhorro")} />
              <p className="text-xs text-stone-500">Intereses, dividendos, plusvalías</p>
            </div>
          </div>

          <div className="rounded-md bg-stone-50 p-3 text-sm text-stone-700">
            Base liquidable general: <strong>{eur(res.baseGeneral)}</strong> · cuota disponible
            para deducciones: <strong className="text-emerald-950">{eur(res.cuotaDisp)}</strong>
            {res.ahorroEpsvMarginal > 0.5 && (
              <span> · la EPSV ya te ahorra <strong>{eur(res.ahorroEpsvMarginal)}</strong> de IRPF</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="m36" className="leading-snug">
              Menor de 36 años al comprar
              <span className="block text-xs font-normal text-stone-500">
                23 % y, en el año de compra, deducción sin límite de 8.500 € con traslado del exceso
                a los 5 ejercicios siguientes (mientras sigas teniendo menos de 36)
              </span>
            </Label>
            <Switch id="m36" checked={menor36} onCheckedChange={(v) => upd("menor36", v)} />
          </div>
          {menor36 && (
            <div className="space-y-1">
              <Label htmlFor="edad">Edad en el año de compra</Label>
              <Input id="edad" type="number" value={edad} onChange={num("edad")} />
            </div>
          )}
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="c23" className="leading-snug">
              Familia numerosa, monoparental, víctima de violencia de género o doméstica,
              discapacidad ≥ 65 % o dependencia (o conviviente)
              <span className="block text-xs font-normal text-stone-500">
                Aplica el 23 % (con el límite anual de 1.955 €)
              </span>
            </Label>
            <Switch id="c23" checked={colectivo23} onCheckedChange={(v) => upd("colectivo23", v)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="cons">Crédito ya consumido (€)</Label>
              <Input id="cons" type="number" value={creditoConsumido} onChange={num("creditoConsumido")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="gan">Ganancia exenta por reinversión (€)</Label>
              <Input id="gan" type="number" value={gananciaExenta} onChange={num("gananciaExenta")} />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="c26" className="leading-snug">
              Vivienda adquirida a partir del 1/1/2026
              <span className="block text-xs font-normal text-stone-500">
                Sin deducción si alguna base liquidable es ≥ 68.000 €
              </span>
            </Label>
            <Switch id="c26" checked={compraDesde2026} onCheckedChange={(v) => upd("compraDesde2026", v)} />
          </div>
        </CardContent>
      </Card>

      {res.jugadaEpsv && (
        <Card className={res.jugadaEpsv.activada ? "border-emerald-300 bg-emerald-50" : "border-amber-300 bg-amber-50"}>
          <CardContent className="pt-4 text-sm">
            {res.jugadaEpsv.activada ? (
              <p className="text-emerald-950">
                <strong>Jugada EPSV activada:</strong> tu aportación deja la base general por debajo
                de 68.000 €, así que conservas la deducción por vivienda. Doble efecto: ahorras{" "}
                <strong>{eur(res.jugadaEpsv.ahorroIrpf)}</strong> de IRPF por la aportación y
                mantienes una deducción de vivienda de{" "}
                <strong>{eur(res.jugadaEpsv.dedRecuperada)}</strong> este año.
              </p>
            ) : (
              <p className="text-amber-900">
                <strong>Jugada EPSV disponible:</strong> tu base liquidable general supera por poco
                los 68.000 € y pierdes la deducción por vivienda. Aportando{" "}
                <strong>{eur(res.jugadaEpsv.necesario)}</strong> a una EPSV bajarías del umbral:
                ahorrarías <strong>{eur(res.jugadaEpsv.ahorroIrpf)}</strong> de IRPF por la propia
                aportación y recuperarías una deducción de vivienda de{" "}
                <strong>{eur(res.jugadaEpsv.dedRecuperada)}</strong> este año. Dos reglas forales,
                un mismo movimiento.
              </p>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="border-emerald-900/20">
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Hipoteca normal vs optimizada con el crédito fiscal</CardTitle>
          <CardDescription>
            Crédito disponible <Badge variant="secondary">{eur(res.creditoInicial)}</Badge>. La
            estrategia optimizada amortiza anticipadamente cada año lo necesario para alcanzar los
            8.500 € de inversión deducible.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <DepositoForal disponible={res.creditoInicial} />
          {res.excluidoPorBase && (
            <p className="rounded-md bg-red-50 p-3 text-sm text-red-800">
              Con alguna base liquidable ≥ 68.000 € y vivienda comprada desde 2026 no puedes aplicar
              la deducción este año. El límite se revisa año a año.
            </p>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-xs font-medium text-stone-500">Sin optimizar</p>
              <p className="mt-1 text-sm text-stone-700">
                Deducciones aplicadas: <strong>{eur(res.normal.deduccionTotal)}</strong>
              </p>
              <p className="text-sm text-stone-700">
                Intereses pagados: <strong>{eur(res.normal.interesTotal)}</strong>
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-medium text-emerald-900/70">Optimizada</p>
              <p className="mt-1 text-sm text-emerald-950">
                Deducciones aplicadas: <strong>{eur(res.optimo.deduccionTotal)}</strong>
              </p>
              <p className="text-sm text-emerald-950">
                Intereses pagados: <strong>{eur(res.optimo.interesTotal)}</strong>
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-white p-3 text-sm text-stone-700">
            <p className="font-medium text-emerald-950">Resultado de optimizar</p>
            <p>• Deducción fiscal adicional: <strong>{eur(res.deduccionExtra)}</strong></p>
            <p>• Intereses ahorrados por amortizar antes: <strong>{eur(res.interesAhorrado)}</strong></p>
            <p>
              • Beneficio total estimado: <strong>{eur(beneficioOptimizar)}</strong>, dedicando{" "}
              {eur(res.optimo.extraTotal)} a amortización anticipada.
            </p>
            {res.optimo.creditoFinal > 0.5 && (
              <p className="mt-1 text-xs text-stone-500">
                Al terminar quedarían {eur(res.optimo.creditoFinal)} de crédito fiscal sin usar.
              </p>
            )}
          </div>

          <Separator />

          <div>
            <p className="mb-2 text-sm font-medium text-emerald-950">
              Proyección año a año (estrategia optimizada)
            </p>
            <div className="max-h-64 overflow-y-auto rounded-md border border-stone-200">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-stone-100 text-stone-600">
                  <tr>
                    <th className="p-2 text-left">Año</th>
                    <th className="p-2 text-right">Invertido</th>
                    <th className="p-2 text-right">Tipo</th>
                    <th className="p-2 text-right">Deducción aplicada</th>
                    <th className="p-2 text-right">Pendiente (&lt;36)</th>
                    <th className="p-2 text-right">Crédito restante</th>
                    <th className="p-2 text-right">Saldo hipoteca</th>
                  </tr>
                </thead>
                <tbody>
                  {res.optimo.filas.map((f) => (
                    <tr key={f.anio} className="border-t border-stone-100">
                      <td className="p-2">{f.anio}</td>
                      <td className="p-2 text-right">{eur(f.invertido)}</td>
                      <td className="p-2 text-right">{(f.tipo * 100).toFixed(0)} %</td>
                      <td className="p-2 text-right font-medium text-emerald-800">{eur(f.aplicada)}</td>
                      <td className="p-2 text-right">{f.pendiente > 0.5 ? eur(f.pendiente) : "—"}</td>
                      <td className="p-2 text-right">{eur(f.credito)}</td>
                      <td className="p-2 text-right">{eur(f.saldo)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-1 text-xs text-stone-500">
            <p>
              <strong className="text-stone-600">Motor validado</strong> contra el ejemplo oficial
              de la Hacienda Foral y la columna de cuotas de la tarifa 2026 (44 comprobaciones).
              Reglas: base deducible = capital + intereses + metálico del año de compra; máximo
              8.500 €/año salvo el año de compra para menores de 36; techo en tu cuota (íntegra
              menos minoración de 1.615 €) — lo no aplicado se pierde salvo para menores de 36, que
              lo trasladan 5 ejercicios; crédito vitalicio de 36.000 €; EPSV reducible hasta
              5.000 €/año (los excesos también se trasladan 5 ejercicios).
            </p>
            <p>
              Simplificaciones: asalariado sin otras rentas generales ni deducciones familiares,
              sueldo y tipo constantes, un solo titular. No sustituye asesoramiento fiscal.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


/* ---------- EPSV ---------- */

function TabEpsv({ datos, upd, emitir }) {
  const { sueldoBruto, epsv, epsvEmpresa, baseAhorro, compraDesde2026 } = datos;
  const tipoC = datos.tipoContribuyente || "trabajador";
  const planes = datos.epsvPlanes || [];

  const num = (key) => (e) => {
    const v = Number(e.target.value);
    upd(key, Number.isFinite(v) ? Math.max(0, v) : 0);
  };

  const res = useMemo(() => {
    const reducible = epsvReducible(epsv, epsvEmpresa);
    const exceso = Math.max(0, epsv - reducible);
    const baseSin = baseLiquidableGeneral(sueldoBruto, 0, tipoC);
    const baseCon = baseLiquidableGeneral(sueldoBruto, reducible, tipoC);
    const ahorro = cuotaGeneral(baseSin) - cuotaGeneral(baseCon);
    const margen = epsvReducible(EPSV_MAX_INDIVIDUAL, epsvEmpresa);

    // Tabla: ahorro por niveles de aportación individual
    const niveles = [1000, 2000, 3000, 4000, 5000]
      .map((a) => {
        const red = epsvReducible(a, epsvEmpresa);
        const ah = cuotaGeneral(baseSin) - cuotaGeneral(baseLiquidableGeneral(sueldoBruto, red, tipoC));
        return { a, red, ah, pct: red > 0 ? ah / red : 0 };
      });

    // Jugada del límite de 68.000 €
    let jugada = null;
    if (compraDesde2026 && baseAhorro < 68000 && baseSin >= 68000 && baseSin - margen < 68000) {
      const necesario = Math.ceil(baseSin - 67999);
      jugada = {
        necesario,
        ahorroIrpf: cuotaGeneral(baseSin) - cuotaGeneral(baseSin - necesario),
        activada: reducible >= necesario,
      };
    }

    // Cartera de planes y rescate (régimen 2026)
    const totAportado = planes.reduce((s, p) => s + (Number(p.aportado) || 0), 0);
    const totDerechos = planes.reduce((s, p) => s + (Number(p.derechos) || 0), 0);
    const rentab = Math.max(0, totDerechos - totAportado);
    const aportIntegrable = Math.min(totAportado, 300000) * 0.7 + Math.max(0, totAportado - 300000);
    const impTrabajoCapital = cuotaGeneral(baseCon + aportIntegrable) - cuotaGeneral(baseCon);
    const impRentabAhorro = cuotaAhorro(baseAhorro + rentab) - cuotaAhorro(baseAhorro);
    const rescate = {
      totAportado, totDerechos, rentab,
      impCapital: impTrabajoCapital + impRentabAhorro,
      impTrabajoCapital, impRentabAhorro,
    };

    return { reducible, exceso, baseSin, baseCon, ahorro, niveles, jugada, rescate,
      conjunto: reducible + Math.min(epsvEmpresa, EPSV_MAX_EMPRESA) };
  }, [sueldoBruto, epsv, epsvEmpresa, baseAhorro, compraDesde2026, tipoC, planes]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Tus aportaciones a EPSV</CardTitle>
          <CardDescription>
            Las aportaciones reducen tu base imponible general. Límites 2026: 5.000 € individuales,
            8.000 € empresariales y 10.000 € conjuntos.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="esb">{tipoC === "autonomo" ? "Rendimiento neto anual (€)" : "Sueldo bruto anual (€)"}</Label>
            <Input id="esb" type="number" value={sueldoBruto} onChange={num("sueldoBruto")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eind">Aportación individual (€)</Label>
            <Input id="eind" type="number" value={epsv} onChange={num("epsv")} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="eemp">Contribución de tu empresa (€)</Label>
            <Input id="eemp" type="number" value={epsvEmpresa} onChange={num("epsvEmpresa")} />
          </div>
        </CardContent>
      </Card>

      <Card className="border-emerald-900/20">
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Efecto de tus aportaciones</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 text-center">
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-xs text-emerald-900/70">Ahorro de IRPF este año</p>
              <p className="font-display num text-3xl font-semibold tracking-tight text-emerald-900">{eur(res.ahorro)}</p>
              {res.reducible > 0 && (
                <p className="text-xs text-emerald-900/70">
                  {((res.ahorro / res.reducible) * 100).toFixed(0)} % de lo aportado vuelve vía IRPF
                </p>
              )}
            </div>
            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-xs text-stone-500">Reducción aplicada en base</p>
              <p className="font-display num text-3xl font-semibold tracking-tight text-stone-800">{eur(res.reducible)}</p>
              <p className="text-xs text-stone-500">
                Base: {eur(res.baseSin)} → {eur(res.baseCon)}
              </p>
            </div>
          </div>

          {res.exceso > 0.5 && (
            <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-900">
              Aportas {eur(res.exceso)} por encima de lo reducible este año
              {Math.min(epsvEmpresa, EPSV_MAX_EMPRESA) + EPSV_MAX_INDIVIDUAL > EPSV_MAX_CONJUNTO &&
                epsvEmpresa > 0 ? " (el límite conjunto de 10.000 € con la contribución de tu empresa lo recorta)" : ""}.
              Ese exceso no se pierde: se traslada como reducción a los 5 ejercicios siguientes.
            </p>
          )}

          {res.jugada && (
            <p className={"rounded-md p-3 text-sm " + (res.jugada.activada
              ? "bg-emerald-50 text-emerald-950" : "bg-amber-50 text-amber-900")}>
              {res.jugada.activada ? (
                <span><strong>Jugada del 68.000 € activada:</strong> tu aportación deja la base
                general por debajo del umbral y conservas la deducción por vivienda habitual.</span>
              ) : (
                <span><strong>Jugada del 68.000 € disponible:</strong> aportando{" "}
                <strong>{eur(res.jugada.necesario)}</strong> tu base general bajaría de 68.000 € —
                ahorrarías <strong>{eur(res.jugada.ahorroIrpf)}</strong> de IRPF y además
                recuperarías la deducción por vivienda (detalle en la pestaña Hipoteca).</span>
              )}
            </p>
          )}

          <Separator />

          <div>
            <p className="mb-2 text-sm font-medium text-emerald-950">
              ¿Cuánto te devuelve cada nivel de aportación individual?
            </p>
            <div className="rounded-md border border-stone-200">
              <table className="w-full text-xs">
                <thead className="bg-stone-100 text-stone-600">
                  <tr>
                    <th className="p-2 text-right">Aportas</th>
                    <th className="p-2 text-right">Reducible</th>
                    <th className="p-2 text-right">Ahorro IRPF</th>
                    <th className="p-2 text-right">Retorno</th>
                  </tr>
                </thead>
                <tbody>
                  {res.niveles.map((n) => (
                    <tr key={n.a} className="border-t border-stone-100">
                      <td className="p-2 text-right">{eur(n.a)}</td>
                      <td className="p-2 text-right">{eur(n.red)}</td>
                      <td className="p-2 text-right font-medium text-emerald-800">{eur(n.ah)}</td>
                      <td className="p-2 text-right">{(n.pct * 100).toFixed(0)} %</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              El retorno baja al agotar tramos de la tarifa: aportar tiene más sentido mientras
              reduce renta gravada a tipos altos.
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <p className="text-sm font-medium text-emerald-950">Tu cartera de planes EPSV</p>
            {planes.map((p) => (
              <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_84px_84px_28px] items-end gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Plan</Label>
                  <Input value={p.nombre}
                    onChange={(e) => emitir("PLAN_EPSV_ACTUALIZADO", { id: p.id, campo: "nombre", valor: e.target.value })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Aportado (€)</Label>
                  <Input type="number" value={p.aportado}
                    onChange={(e) => emitir("PLAN_EPSV_ACTUALIZADO", { id: p.id, campo: "aportado", valor: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Derechos (€)</Label>
                  <Input type="number" value={p.derechos}
                    onChange={(e) => emitir("PLAN_EPSV_ACTUALIZADO", { id: p.id, campo: "derechos", valor: Math.max(0, Number(e.target.value) || 0) })} />
                </div>
                <button type="button" title="Eliminar" aria-label="Eliminar"
                  onClick={() => emitir("PLAN_EPSV_ELIMINADO", { id: p.id })}
                  className="h-9 rounded-md bg-red-50 text-sm text-red-700 hover:bg-red-100">✕</button>
              </div>
            ))}
            <button type="button"
              onClick={() => emitir("PLAN_EPSV_ANADIDO", { id: nuevoId(), nombre: "Nuevo plan", aportado: 0, derechos: 0 })}
              className="rounded-md bg-stone-100 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-stone-200">
              + Añadir plan
            </button>
          </div>

          {res.rescate.totDerechos > 0 && (
            <div className="rounded-lg border border-emerald-200 bg-white p-3 text-sm text-stone-700">
              <p className="font-medium text-emerald-950">Optimización del rescate</p>
              <p>
                Derechos: <strong>{eur(res.rescate.totDerechos)}</strong> ({eur(res.rescate.totAportado)}{" "}
                aportados + <strong>{eur(res.rescate.rentab)}</strong> de rentabilidad).
              </p>
              <p className="mt-1">
                • <strong>Rescate en capital de golpe:</strong> ~{eur(res.rescate.impCapital)} de
                impuesto ({eur(res.rescate.impTrabajoCapital)} por las aportaciones, integradas al
                70 % en base general, y {eur(res.rescate.impRentabAhorro)} por la rentabilidad en
                base del ahorro).
              </p>
              <p>
                • <strong>Rentabilidad como renta vitalicia (o temporal ≥ 15 años): exenta</strong>
                {" "}— te ahorras los {eur(res.rescate.impRentabAhorro)} de la rentabilidad. Y
                cobrar las aportaciones repartidas en varios años baja su marginal frente al cobro
                único.
              </p>
              <p className="mt-1 text-xs text-stone-500">
                Recuerda: la integración al 70 % solo aplica a la primera prestación de cada
                contingencia y con más de 2 años desde la primera aportación. Estimación usando tu
                base actual como aproximación de la renta en jubilación.
              </p>
            </div>
          )}

          <div className="space-y-1 text-xs text-stone-500">
            <p>
              <strong className="text-stone-600">Reglas aplicadas:</strong> reducción individual
              hasta 5.000 €/año, recortada por el límite conjunto de 10.000 € con las contribuciones
              empresariales (máx. 8.000 €, neutras en tu base dentro de sus límites); excesos
              trasladables 5 ejercicios; sin reducción a partir del año siguiente a la jubilación.
            </p>
            <p>
              El rescate tributa con el régimen 2026: las aportaciones como rendimiento de trabajo
              (en capital, integración al 70 % hasta 300.000 € en la primera prestación) y la
              rentabilidad como capital mobiliario en la base del ahorro (exenta si se cobra como
              renta vitalicia o temporal ≥ 15 años). Esta pestaña optimiza la entrada, no el rescate.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}


/* ---------- Cartera de acciones y ETFs ---------- */

const UMBRAL_3PCT = 0.03 / 0.19; // ~15,8 %: plusvalía relativa a partir de la cual gana el 3 %

function TabCartera({ datos, upd, emitir, decidir }) {
  const cartera = datos.cartera || [];
  const { otrasRentas } = datos;

  const setPos = (id, k, v) =>
    emitir("POSICION_ACTUALIZADA", { id, campo: k, valor: v });
  const numPos = (id, k) => (e) =>
    setPos(id, k, Math.max(0, Number(e.target.value) || 0));

  const res = useMemo(() => {
    const pos = cartera.map((p) => {
      const compra = Number(p.compra) || 0;
      const actual = Number(p.actual) || 0;
      const ganancia = actual - compra;
      const ratio = actual > 0 ? ganancia / actual : 0;
      const elegible = p.tipo !== "fondo";
      let regimen, motivo;
      if (ganancia < 0) {
        regimen = "general";
        motivo = "Pérdida: véndela en un año de régimen general para compensarla";
      } else if (!elegible) {
        regimen = "general";
        motivo = "Fondo de inversión: no elegible para el 3 %";
      } else if (ratio >= UMBRAL_3PCT) {
        regimen = "3pct";
        motivo = "Plusvalía del " + (ratio * 100).toFixed(0) + " % ≥ 16 %: trocear al 3 %";
      } else {
        regimen = "general";
        motivo = "Plusvalía del " + (ratio * 100).toFixed(0) + " % < 16 %: mejor régimen general";
      }
      return { ...p, compra, actual, ganancia, ratio, elegible, regimen, motivo };
    });

    const valorTotal = pos.reduce((s, p) => s + p.actual, 0);
    const gananciaTotal = pos.reduce((s, p) => s + p.ganancia, 0);

    const bucketG = pos.filter((p) => p.regimen === "general");
    const bucket3 = pos.filter((p) => p.regimen === "3pct");

    // Año de régimen general: se vende todo el bloque general, compensando pérdidas
    const gananciasG = bucketG.reduce((s, p) => s + Math.max(0, p.ganancia), 0);
    const perdidasG = bucketG.reduce((s, p) => s + Math.min(0, p.ganancia), 0);
    const netaG = Math.max(0, gananciasG + perdidasG);
    const valorG = bucketG.reduce((s, p) => s + p.actual, 0);
    const impG = cuotaAhorro(otrasRentas + netaG) - cuotaAhorro(otrasRentas);

    // Años al 3 %: tramos de 9.999 € del bloque elegible de plusvalía alta
    const valor3 = bucket3.reduce((s, p) => s + p.actual, 0);
    const anios3 = valor3 > 0 ? Math.ceil(valor3 / TRAMO_3PCT) : 0;
    const imp3 = valor3 * 0.03;

    // Comparación: vender toda la cartera de golpe (régimen general, neto de pérdidas)
    const netaTodo = Math.max(0, pos.reduce((s, p) => s + p.ganancia, 0));
    const impGolpe = cuotaAhorro(otrasRentas + netaTodo) - cuotaAhorro(otrasRentas);

    const planTotal = impG + imp3;
    const planAnios = (valorG > 0 ? 1 : 0) + anios3;

    return {
      pos, valorTotal, gananciaTotal, bucketG, bucket3,
      valorG, netaG, impG, perdidasG, valor3, anios3, imp3,
      impGolpe, planTotal, planAnios, ahorro: impGolpe - planTotal,
    };
  }, [cartera, otrasRentas]);

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Tu cartera de acciones y ETFs</CardTitle>
          <CardDescription>
            Posiciones a precios actuales. Valor: <strong>{eur(res.valorTotal)}</strong> ·
            plusvalía latente: <strong>{eur(res.gananciaTotal)}</strong>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {res.pos.map((p) => (
            <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_64px_72px_72px_28px] items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Posición</Label>
                <Input value={p.nombre} onChange={(e) => setPos(p.id, "nombre", e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Tipo</Label>
                <select value={p.tipo} onChange={(e) => setPos(p.id, "tipo", e.target.value)}
                  className="h-9 w-full rounded-md border border-stone-200 bg-white px-2 text-sm">
                  <option value="accion">Acción</option>
                  <option value="etf">ETF</option>
                  <option value="fondo">Fondo</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Compra (€)</Label>
                <Input type="number" value={p.compra} onChange={numPos(p.id, "compra")} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Actual (€)</Label>
                <Input type="number" value={p.actual} onChange={numPos(p.id, "actual")} />
              </div>
              <button type="button" title="Eliminar" aria-label="Eliminar"
                onClick={() => emitir("POSICION_ELIMINADA", { id: p.id })}
                className="h-9 rounded-md bg-red-50 text-sm text-red-700 hover:bg-red-100">✕</button>
            </div>
          ))}
          <button type="button"
            onClick={() => emitir("POSICION_ANADIDA", { id: nuevoId(), nombre: "Nueva posición", tipo: "accion", compra: 0, actual: 0 })}
            className="rounded-md bg-stone-100 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-stone-200">
            + Añadir posición
          </button>
        </CardContent>
      </Card>

      <Card className="border-emerald-900/20">
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Plan de desinversión optimizado</CardTitle>
          <CardDescription>
            La opción del 3 % es todo o nada por ejercicio, así que el plan dedica años distintos a
            cada régimen: uno general (plusvalías bajas, fondos y pérdidas, que compensan entre sí)
            y los siguientes al 3 % en tramos de 9.999 €.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md border border-stone-200">
            <table className="w-full text-xs">
              <thead className="bg-stone-100 text-stone-600">
                <tr>
                  <th className="p-2 text-left">Posición</th>
                  <th className="p-2 text-right">Plusvalía</th>
                  <th className="p-2 text-left">Recomendación</th>
                </tr>
              </thead>
              <tbody>
                {res.pos.map((p) => (
                  <tr key={p.id} className="border-t border-stone-100">
                    <td className="p-2">{p.nombre}</td>
                    <td className={"p-2 text-right font-medium " + (p.ganancia < 0 ? "text-red-700" : "text-emerald-800")}>
                      {eur(p.ganancia)}
                    </td>
                    <td className="p-2">
                      <span className={"mr-1 rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                        (p.regimen === "3pct" ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700")}>
                        {p.regimen === "3pct" ? "3 %" : "General"}
                      </span>
                      {p.motivo}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-xs font-medium text-stone-500">Vender todo de golpe (general)</p>
              <p className="mt-1 font-display num text-3xl font-semibold tracking-tight text-stone-800">{eur(res.impGolpe)}</p>
              <p className="text-xs text-stone-500">en 1 año, pérdidas ya compensadas</p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-medium text-emerald-900/70">Plan optimizado</p>
              <p className="mt-1 font-display num text-3xl font-semibold tracking-tight text-emerald-900">{eur(res.planTotal)}</p>
              <p className="text-xs text-emerald-900/70">
                en {res.planAnios} {res.planAnios === 1 ? "año" : "años"} · ahorro {eur(res.ahorro)}
              </p>
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200 bg-white p-3 text-sm text-stone-700">
            <p className="font-medium text-emerald-950">El plan, paso a paso</p>
            {res.valorG > 0 && (
              <p>
                • <strong>Año 1 (régimen general):</strong> vendes {eur(res.valorG)} del bloque
                general — ganancia neta {eur(res.netaG)}
                {res.perdidasG < -0.5 ? " tras compensar " + eur(-res.perdidasG) + " de pérdidas" : ""} →
                pagas {eur(res.impG)}.
              </p>
            )}
            {res.anios3 > 0 && (
              <p>
                • <strong>{res.valorG > 0 ? "Años siguientes" : "Cada año"} (3 %):</strong> vendes el
                bloque de plusvalía alta ({eur(res.valor3)}) en {res.anios3}{" "}
                {res.anios3 === 1 ? "tramo" : "tramos"} de hasta 9.999 € → pagas {eur(res.imp3)} en
                total, optando expresamente al gravamen especial cada año.
              </p>
            )}
            {res.valorG === 0 && res.anios3 === 0 && <p>Añade posiciones para generar el plan.</p>}
          </div>

          {(res.valorG > 0 || res.anios3 > 0) && (
            <button type="button"
              onClick={() =>
                decidir("VENTA_REGISTRADA", planificarVentas(res.bucketG, res.bucket3, ANIO_ACTUAL))}
              className="w-full rounded-md bg-emerald-700 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-800">
              Aplicar plan de ventas desde {ANIO_ACTUAL} (se liquida abajo) ↓
            </button>
          )}

          <p className="text-xs text-stone-500">
            Los ETFs cotizan en mercados regulados y aquí se tratan como elegibles para el 3 %;
            confírmalo para tu caso, porque el criterio puede depender del producto concreto. Las
            pérdidas no compensadas en el año pueden compensarse en los 4 siguientes. Al aplicar el
            plan, cada venta se registra como evento y la pestaña Desinversiones liquida cada
            ejercicio con su régimen óptimo. El plan asume
            precios constantes: mantener posiciones años conlleva riesgo de mercado que puede pesar
            más que el ahorro fiscal. No sustituye asesoramiento.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

/* ---------- Desinversiones: escala del ahorro y regla del 3 % ---------- */

// Escala de la base del ahorro en vigor desde el 1/1/2026 (NF 2/2025)
const ESCALA_AHORRO = [
  { hasta: 7500, tipo: 0.19 },
  { hasta: 15000, tipo: 0.20 },
  { hasta: 30000, tipo: 0.22 },
  { hasta: 50000, tipo: 0.24 },
  { hasta: 90000, tipo: 0.255 },
  { hasta: 120000, tipo: 0.26 },
  { hasta: 240000, tipo: 0.265 },
  { hasta: 300000, tipo: 0.27 },
  { hasta: Infinity, tipo: 0.28 },
];

const LIMITE_3PCT = 10000; // el valor de transmisión anual debe ser INFERIOR a este importe
const TRAMO_3PCT = 9999;

function cuotaAhorro(base) {
  let cuota = 0;
  let prev = 0;
  for (const t of ESCALA_AHORRO) {
    if (base <= prev) break;
    cuota += (Math.min(base, t.hasta) - prev) * t.tipo;
    prev = t.hasta;
  }
  return Math.max(0, cuota);
}

// Impuesto marginal de añadir una ganancia sobre otras rentas del ahorro ya existentes
const impuestoGanancia = (ganancia, otras) =>
  Math.max(0, cuotaAhorro(otras + Math.max(0, ganancia)) - cuotaAhorro(otras));


// Proyección de dominio: liquidación del log de ventas por ejercicio fiscal,
// eligiendo en cada uno el régimen óptimo (todo o nada por ejercicio).
function liquidarVentas(ventas, otrasRentas) {
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

function Desinversiones({ datos, upd, emitir }) {
  const { valorVenta, valorCompra, otrasRentas, cotizados } = datos;
  const cartera = datos.cartera || [];
  const ventas = datos.ventas || [];
  const disponibles = cartera.filter((p) => (Number(p.actual) || 0) > 0.01);
  const [posSel, setPosSel] = useState("");
  const [importeVenta, setImporteVenta] = useState(0);
  const [ejercicioVenta, setEjercicioVenta] = useState(ANIO_ACTUAL);

  const ejercicios = useMemo(() => liquidarVentas(ventas, otrasRentas), [ventas, otrasRentas]);

  const num = (key) => (e) => {
    const v = Number(e.target.value);
    upd(key, Number.isFinite(v) ? Math.max(0, v) : 0);
  };

  const res = useMemo(() => {
    const ganancia = Math.max(0, valorVenta - valorCompra);
    const ratio = valorVenta > 0 ? ganancia / valorVenta : 0;

    // Escenario A: vender todo de golpe, régimen general
    const impuestoGolpe = impuestoGanancia(ganancia, otrasRentas);

    // Escenario B: vender de golpe con la regla del 3 % (solo si cabe en un año)
    const cabeEnUnAnio = cotizados && valorVenta < LIMITE_3PCT;
    const impuesto3pctGolpe = cabeEnUnAnio ? valorVenta * 0.03 : null;

    // Escenario C: plan plurianual en tramos de 9.999 €, eligiendo cada año lo mejor
    let plan = null;
    if (cotizados && valorVenta > 0) {
      const filas = [];
      let restante = valorVenta;
      let anio = 0;
      let total = 0;
      while (restante > 0.01 && anio < 60) {
        anio++;
        const tramo = Math.min(TRAMO_3PCT, restante);
        const gananciaTramo = tramo * ratio;
        const via3 = tramo * 0.03;
        const viaGeneral = impuestoGanancia(gananciaTramo, otrasRentas);
        const usar3 = via3 <= viaGeneral;
        const pago = usar3 ? via3 : viaGeneral;
        total += pago;
        filas.push({ anio, tramo, gananciaTramo, pago, usar3 });
        restante -= tramo;
      }
      plan = { filas, total, anios: anio };
    }

    const mejorGolpe = impuesto3pctGolpe !== null ? Math.min(impuestoGolpe, impuesto3pctGolpe) : impuestoGolpe;
    const ahorroPlan = plan ? mejorGolpe - plan.total : 0;
    const umbralRatio = 0.03 / ESCALA_AHORRO[0].tipo; // ~15,8 %: a partir de aquí el 3 % gana al tipo mínimo

    return {
      ganancia,
      ratio,
      impuestoGolpe,
      impuesto3pctGolpe,
      cabeEnUnAnio,
      plan,
      ahorroPlan,
      umbralRatio,
      tipoMedioGolpe: ganancia > 0 ? impuestoGolpe / ganancia : 0,
    };
  }, [valorVenta, valorCompra, otrasRentas, cotizados]);

  return (
    <div className="space-y-4">
      {(() => {
        const f = ejercicios.filas.find((x) => x.ejercicio === ANIO_ACTUAL) ||
          { vCot: 0, gCot: 0, gFon: 0, general: 0, op3: null, usa3: false, excede: false, lista: [] };
        const pct = Math.min(100, (f.vCot / LIMITE_3PCT) * 100);
        const colorBarra = f.excede ? "#B3402F" : pct >= 80 ? "#B9821D" : "#2A5A38";
        const margen = Math.max(0, LIMITE_3PCT - 1 - f.vCot);
        const ahorro = f.op3 !== null ? Math.abs(f.general - f.op3) : 0;
        return (
          <Card className={f.excede ? "border-red-300" : "border-emerald-900/20"}>
            <CardHeader>
              <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">
                Ejercicio {ANIO_ACTUAL} · comparador de regímenes
              </CardTitle>
              <CardDescription>
                El gravamen del 3 % exige que el conjunto de cotizados vendidos en el año sea
                inferior a 10.000 €, y la opción es todo o nada para el ejercicio.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-stone-500">
                    Cotizados vendidos en {ANIO_ACTUAL}
                  </p>
                  <p className="font-display num text-lg font-semibold text-emerald-950">
                    {eur(f.vCot)}{" "}
                    <span className="text-xs font-normal text-stone-500">de 10.000 €</span>
                  </p>
                </div>
                <div className="relative mt-1 h-3 overflow-hidden rounded-full border border-emerald-900/15 bg-stone-200/80">
                  <div className="h-full rounded-full transition-all"
                    style={{ width: pct + "%", background: colorBarra }} />
                </div>
                {!f.excede && (
                  <p className="mt-0.5 text-[11px] text-stone-500">
                    Margen para seguir optando al 3 %: {eur(margen)} más en cotizados este año
                  </p>
                )}
              </div>

              {f.excede && (
                <p className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
                  <strong>Has superado los 10.000 € en cotizados este ejercicio:</strong> la opción
                  del 3 % ya no está disponible en {ANIO_ACTUAL} y todo tributa por el régimen
                  general. Anula o mueve al menos <strong>{eur(f.vCot - (LIMITE_3PCT - 1))}</strong>{" "}
                  de ventas a {ANIO_ACTUAL + 1} para recuperarla.
                </p>
              )}

              {f.vCot > 0 || f.gFon !== 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className={"rounded-lg p-3 " + (!f.usa3 ? "bg-emerald-50 ring-1 ring-emerald-300" : "bg-stone-50")}>
                      <p className="text-xs font-medium text-stone-500">Régimen general</p>
                      <p className="font-display num mt-1 text-3xl font-semibold tracking-tight text-stone-800">
                        {eur(f.general)}
                      </p>
                      <p className="text-xs text-stone-500">
                        Ganancia neta {eur(Math.max(0, f.gCot + f.gFon))} a la escala 19–28 %
                      </p>
                    </div>
                    <div className={"rounded-lg p-3 " + (f.op3 === null ? "bg-stone-50 opacity-60"
                      : f.usa3 ? "bg-emerald-50 ring-1 ring-emerald-300" : "bg-stone-50")}>
                      <p className="text-xs font-medium text-stone-500">Gravamen del 3 %</p>
                      <p className="font-display num mt-1 text-3xl font-semibold tracking-tight text-emerald-900">
                        {f.op3 !== null ? eur(f.op3) : "—"}
                      </p>
                      <p className="text-xs text-stone-500">
                        {f.op3 !== null
                          ? "3 % × " + eur(f.vCot) + (f.gFon > 0.5 ? " + fondos por general" : "")
                          : "No disponible: cotizados ≥ 10.000 €"}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm text-stone-700">
                    {f.op3 === null
                      ? "Óptimo " + ANIO_ACTUAL + ": régimen general (única opción)."
                      : f.usa3
                        ? "Óptimo " + ANIO_ACTUAL + ": optar al 3 % en la declaración — ahorras "
                        : "Óptimo " + ANIO_ACTUAL + ": régimen general — el 3 % costaría "}
                    {f.op3 !== null && <strong className="text-emerald-950">{eur(ahorro)}</strong>}
                    {f.op3 !== null && (f.usa3 ? " frente al general." : " de más.")}
                  </p>
                </>
              ) : (
                <p className="text-sm text-stone-500">
                  Sin ventas en {ANIO_ACTUAL} todavía: registra una abajo o aplica el plan desde la
                  cartera y aquí verás qué régimen conviene.
                </p>
              )}
            </CardContent>
          </Card>
        );
      })()}

      <Card className="border-emerald-900/20">
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Plan de ventas desde tu cartera</CardTitle>
          <CardDescription>
            Cada venta es un evento del log: descuenta la posición con coste proporcional y se
            liquida aquí por ejercicios, eligiendo cada año el régimen óptimo (3 % vs general).
            Vuelca el plan desde la pestaña Cartera o registra ventas a mano.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {disponibles.length > 0 ? (
            <div className="grid grid-cols-[minmax(0,1fr)_84px_56px_auto] items-end gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Posición</Label>
                <select value={posSel} onChange={(e) => setPosSel(e.target.value)}
                  className="h-9 w-full rounded-md border border-stone-200 bg-white px-2 text-sm">
                  <option value="">Elige…</option>
                  {disponibles.map((p) => (
                    <option key={p.id} value={p.id}>{p.nombre} ({eur(p.actual)})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Importe (€)</Label>
                <Input type="number" value={importeVenta}
                  onChange={(e) => setImporteVenta(Math.max(0, Number(e.target.value) || 0))} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Año</Label>
                <Input type="number" value={ejercicioVenta}
                  onChange={(e) => setEjercicioVenta(Math.max(1, Math.round(Number(e.target.value) || 1)))} />
              </div>
              <button type="button"
                disabled={!posSel || importeVenta <= 0}
                onClick={() => {
                  emitir("VENTA_REGISTRADA",
                    { posicionId: posSel, importe: importeVenta, ejercicio: ejercicioVenta });
                  setImporteVenta(0);
                }}
                className={"h-9 rounded-md px-3 text-xs font-medium " +
                  (!posSel || importeVenta <= 0
                    ? "cursor-not-allowed bg-stone-100 text-stone-400"
                    : "bg-emerald-700 text-white hover:bg-emerald-800")}>
                Registrar venta
              </button>
            </div>
          ) : (
            <p className="text-sm text-stone-500">
              No quedan posiciones con saldo en la cartera (pestaña Cartera para añadirlas).
            </p>
          )}

          {ejercicios.filas.length === 0 ? (
            <p className="text-sm text-stone-500">Aún no hay ventas: vuelca el plan desde Cartera o registra una arriba.</p>
          ) : (
            <div className="space-y-2">
              {ejercicios.filas.map((f) => (
                <div key={f.ejercicio} className="rounded-md border border-stone-200 p-2">
                  <div className="flex items-center justify-between text-sm">
                    <p className="font-medium text-emerald-950">
                      Ejercicio {f.ejercicio} ·{" "}
                      <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                        (f.usa3 ? "bg-emerald-100 text-emerald-900" : "bg-stone-200 text-stone-700")}>
                        {f.usa3 ? "Opta al 3 %" : "Régimen general"}
                      </span>
                    </p>
                    <p className="font-semibold text-emerald-900">{eur(f.pago)}</p>
                  </div>
                  <p className="text-xs text-stone-500">
                    Cotizados vendidos: {eur(f.vCot)} (ganancia {eur(f.gCot)})
                    {Math.abs(f.gFon) > 0.5 ? " · fondos: ganancia " + eur(f.gFon) : ""}
                    {f.op3 !== null && !f.usa3 ? " · el 3 % saldría a " + eur(f.op3) : ""}
                    {f.usa3 ? " · el general saldría a " + eur(f.general) : ""}
                  </p>
                  {f.excede && (
                    <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                      Los cotizados de este año alcanzan {eur(f.vCot)} ≥ 10.000 €: pierdes la opción
                      del 3 %. Mueve parte de las ventas a otro ejercicio.
                    </p>
                  )}
                  <ul className="mt-1 space-y-0.5">
                    {f.lista.map((v) => (
                      <li key={v.id} className="flex items-center justify-between text-xs text-stone-600">
                        <span>{v.nombre}: {eur(v.importe)} (ganancia {eur(v.ganancia)})</span>
                        <button type="button"
                          onClick={() => emitir("VENTA_ANULADA", { ventaId: v.id })}
                          className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] text-red-700 hover:bg-red-100">
                          anular
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <div className="flex items-center justify-between gap-2">
                {(() => {
                  const ultima = [...ventas].reverse().find((v) => v.decisionId);
                  if (!ultima) return <span />;
                  const lote = ventas.filter((v) => v.decisionId === ultima.decisionId);
                  return (
                    <button type="button"
                      onClick={() => lote.forEach((v) => emitir("VENTA_ANULADA", { ventaId: v.id }))}
                      className="rounded-md bg-stone-100 px-3 py-1.5 text-xs font-medium text-emerald-900 hover:bg-stone-200">
                      ⟲ Deshacer último plan ({lote.length} ventas)
                    </button>
                  );
                })()}
                <p className="text-right text-sm text-stone-700">
                  Impuesto total del plan:{" "}
                  <strong className="text-emerald-950">{eur(ejercicios.total)}</strong>
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <details className="rounded-xl border border-stone-200 bg-white">
        <summary className="cursor-pointer select-none p-3 text-sm font-medium text-emerald-950 hover:bg-stone-50">
          Cálculo rápido manual (sin tocar la cartera)
        </summary>
        <div className="space-y-4 p-3 pt-0">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Cálculo rápido manual</CardTitle>
          <CardDescription>
            Venta de valores cotizados (acciones admitidas a negociación) siendo residente fiscal
            en Bizkaia. Los fondos de inversión no pueden acogerse a la regla del 3 %.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1">
              <Label htmlFor="vv">Valor de venta (€)</Label>
              <Input id="vv" type="number" value={valorVenta} onChange={num("valorVenta")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="vc">Valor de compra (€)</Label>
              <Input id="vc" type="number" value={valorCompra} onChange={num("valorCompra")} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="or">Otras rentas del ahorro/año (€)</Label>
              <Input id="or" type="number" value={otrasRentas} onChange={num("otrasRentas")} />
            </div>
          </div>
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="cot" className="leading-snug">
              Valores admitidos a negociación (acciones cotizadas)
              <span className="block text-xs font-normal text-stone-500">
                Requisito del gravamen especial del 3 % (DA 24.ª NF 13/2013). Excluye fondos de
                inversión, no cotizadas y derechos de suscripción
              </span>
            </Label>
            <Switch id="cot" checked={cotizados} onCheckedChange={(v) => upd("cotizados", v)} />
          </div>
          <p className="text-sm text-stone-600">
            Ganancia patrimonial: <strong className="text-emerald-950">{eur(res.ganancia)}</strong>{" "}
            ({(res.ratio * 100).toFixed(0)} % del valor de venta)
          </p>
        </CardContent>
      </Card>

      <Card className="border-emerald-900/20">
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Qué pagarías</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-lg bg-stone-50 p-3">
              <p className="text-xs font-medium text-stone-500">Vender todo de golpe (régimen general)</p>
              <p className="mt-1 font-display num text-3xl font-semibold tracking-tight text-stone-800">{eur(res.impuestoGolpe)}</p>
              <p className="text-xs text-stone-500">
                Escala del ahorro 19 %–28 % · tipo medio sobre la ganancia:{" "}
                {(res.tipoMedioGolpe * 100).toFixed(1)} %
              </p>
            </div>
            <div className="rounded-lg bg-emerald-50 p-3">
              <p className="text-xs font-medium text-emerald-900/70">Plan optimizado por años</p>
              <p className="mt-1 font-display num text-3xl font-semibold tracking-tight text-emerald-900">
                {res.plan ? eur(res.plan.total) : "—"}
              </p>
              <p className="text-xs text-emerald-900/70">
                {res.plan
                  ? res.plan.anios + " años en tramos de 9.999 €, eligiendo cada año entre el 3 % y el régimen general"
                  : "Activa valores cotizados para calcularlo"}
              </p>
            </div>
          </div>

          {res.cabeEnUnAnio && res.impuesto3pctGolpe !== null && (
            <p className="rounded-md bg-emerald-50 p-3 text-sm text-emerald-950">
              Tu venta total ya es inferior a 10.000 €, así que puedes optar directamente al 3 %:{" "}
              <strong>{eur(res.impuesto3pctGolpe)}</strong>
              {res.impuesto3pctGolpe < res.impuestoGolpe
                ? " — mejor que el régimen general (" + eur(res.impuestoGolpe) + ")."
                : " — aunque en tu caso el régimen general sale mejor (" + eur(res.impuestoGolpe) + "). La opción es voluntaria: elige la menor."}
            </p>
          )}

          {res.plan && res.ahorroPlan > 0.5 && (
            <p className="rounded-lg border border-emerald-200 bg-white p-3 text-sm text-stone-700">
              <strong className="text-emerald-950">Ahorro de la estrategia: {eur(res.ahorroPlan)}.</strong>{" "}
              Troceando la venta en ejercicios distintos, cada año el valor transmitido queda por
              debajo de 10.000 € y puedes optar al gravamen especial del 3 % sobre el valor de venta
              en lugar de tributar por la ganancia real. Cuanto mayor sea tu plusvalía relativa, más
              ahorras: la regla compensa cuando la ganancia supera aproximadamente el{" "}
              {(res.umbralRatio * 100).toFixed(0)} % del valor de venta.
            </p>
          )}

          {res.plan && res.ahorroPlan <= 0.5 && res.ganancia > 0 && (
            <p className="rounded-md bg-stone-50 p-3 text-sm text-stone-600">
              Con tu plusvalía relativa ({(res.ratio * 100).toFixed(0)} % del valor de venta), trocear
              la venta no mejora apenas el resultado: la regla del 3 % compensa cuando la ganancia
              supera aproximadamente el {(res.umbralRatio * 100).toFixed(0)} % del valor de venta.
            </p>
          )}

          {res.plan && (
            <div>
              <p className="mb-2 text-sm font-medium text-emerald-950">Plan año a año</p>
              <div className="max-h-64 overflow-y-auto rounded-md border border-stone-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-stone-100 text-stone-600">
                    <tr>
                      <th className="p-2 text-left">Año</th>
                      <th className="p-2 text-right">Vendes</th>
                      <th className="p-2 text-right">Ganancia</th>
                      <th className="p-2 text-left">Régimen</th>
                      <th className="p-2 text-right">Pagas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.plan.filas.map((f) => (
                      <tr key={f.anio} className="border-t border-stone-100">
                        <td className="p-2">{f.anio}</td>
                        <td className="p-2 text-right">{eur(f.tramo)}</td>
                        <td className="p-2 text-right">{eur(f.gananciaTramo)}</td>
                        <td className="p-2">
                          {f.usar3 ? "3 % especial" : "General"}
                        </td>
                        <td className="p-2 text-right font-medium text-emerald-800">{eur(f.pago)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <Separator />

          <div className="space-y-1 text-xs text-stone-500">
            <p>
              <strong className="text-stone-600">Requisitos de la regla del 3 %</strong> (DA 24.ª de la
              NF 13/2013 de Bizkaia; equivalentes en Álava —DA 20.ª NF 33/2013— y Gipuzkoa): solo
              transmisiones onerosas de valores admitidos a negociación (no fondos de inversión ni
              derechos de suscripción); el valor de transmisión del <em>conjunto</em> de valores
              vendidos en el ejercicio debe ser inferior a 10.000 €; la opción debe constar
              expresamente en la declaración.
            </p>
            <p>
              <strong className="text-stone-600">La opción es todo o nada por ejercicio:</strong>{" "}
              afecta a la totalidad de los valores cotizados que transmitas ese año; no puedes
              calcular unos por régimen general y otros al 3 %. Si entre ellos hay posiciones en
              pérdidas, optar implica pagar también el 3 % sobre ellas y renunciar a computar y
              compensar esas pérdidas: el 3 % se suma directamente a la cuota íntegra y no se
              integra en la base del ahorro. En años con minusvalías suele convenir el régimen
              general.
            </p>
            <p>
              Orientativo, con la escala del ahorro vigente desde el 1/1/2026 (NF 2/2025). Si tienes
              pérdidas pendientes de compensar o ventas adicionales en el año, el resultado cambia.
              No sustituye asesoramiento fiscal.
            </p>
          </div>
        </CardContent>
      </Card>
        </div>
      </details>
    </div>
  );
}


/* ---------- Mis datos y perfiles ---------- */

const CAMPOS = [
  { grupo: "Situación fiscal", campos: [
    { k: "sueldoBruto", l: "Ingresos anuales: bruto o rendimiento neto (€)" },
    { k: "epsv", l: "Aportación EPSV individual (€)" },
    { k: "epsvEmpresa", l: "Contribución EPSV de la empresa (€)" },
    { k: "baseAhorro", l: "Base del ahorro (€)" },
    { k: "creditoConsumido", l: "Crédito ya consumido (€)" },
    { k: "gananciaExenta", l: "Ganancia exenta reinversión (€)" },
    { k: "edad", l: "Edad en el año de compra" },
    { k: "menor36", l: "Menor de 36 años al comprar", sw: true },
    { k: "colectivo23", l: "Colectivo del 23 % (familia numerosa, monoparental…)", sw: true },
    { k: "compraDesde2026", l: "Vivienda adquirida desde el 1/1/2026", sw: true },
  ]},
  { grupo: "Hipoteca", campos: [
    { k: "prestamo", l: "Préstamo (€)" },
    { k: "interes", l: "Interés (% TIN)" },
    { k: "plazo", l: "Plazo (años)" },
    { k: "metalicoInicial", l: "Metálico en el año de compra (€)" },
  ]},
  { grupo: "Desinversión", campos: [
    { k: "valorVenta", l: "Valor de venta (€)" },
    { k: "valorCompra", l: "Valor de compra (€)" },
    { k: "otrasRentas", l: "Otras rentas del ahorro (€)" },
    { k: "cotizados", l: "Valores admitidos a negociación", sw: true },
  ]},
];

function MisDatos({ datos, upd, eventos, setEventos, deshacer }) {
  const [perfiles, setPerfiles] = useState(null); // null = cargando
  const [nombre, setNombre] = useState("");
  const [msg, setMsg] = useState("");

  const cargarLista = async () => {
    try {
      const res = await storage.get(CLAVE_PERFILES);
      setPerfiles(res && res.value ? JSON.parse(res.value) : {});
    } catch {
      setPerfiles({}); // clave inexistente o storage no disponible
    }
  };
  useEffect(() => { cargarLista(); }, []);

  const guardar = async () => {
    const n = nombre.trim();
    if (!n) { setMsg("Pon un nombre al perfil antes de guardar."); return; }
    try {
      const nuevos = { ...(perfiles || {}), [n]: { eventos, guardado: new Date().toISOString() } };
      const ok = await storage.set(CLAVE_PERFILES, JSON.stringify(nuevos));
      if (ok) { setPerfiles(nuevos); setMsg("Perfil «" + n + "» guardado."); }
      else setMsg("No se pudo guardar el perfil.");
    } catch {
      setMsg("Error al guardar: el almacenamiento no está disponible en este entorno.");
    }
  };

  const cargar = (n) => {
    const perfil = perfiles[n] || {};
    if (Array.isArray(perfil.eventos)) {
      setEventos(perfil.eventos); // re-proyección del log guardado
    } else {
      // Perfil antiguo (guardaba el estado): lo migramos a un evento de importación
      setEventos([{ id: nuevoId(), ts: new Date().toISOString(),
        type: "ESTADO_IMPORTADO", payload: perfil.datos || {} }]);
    }
    setNombre(n);
    setMsg("Perfil «" + n + "» cargado: log reproducido en las calculadoras.");
  };

  const borrar = async (n) => {
    try {
      const nuevos = { ...(perfiles || {}) };
      delete nuevos[n];
      const ok = await storage.set(CLAVE_PERFILES, JSON.stringify(nuevos));
      if (ok) { setPerfiles(nuevos); setMsg("Perfil «" + n + "» eliminado."); }
    } catch {
      setMsg("No se pudo eliminar el perfil.");
    }
  };

  const num = (key) => (e) => {
    const v = Number(e.target.value);
    upd(key, Number.isFinite(v) ? Math.max(0, v) : 0);
  };

  const btn = "rounded-md px-3 py-1.5 text-xs font-medium transition-colors";
  const nombres = perfiles ? Object.keys(perfiles).sort() : [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Tipo de contribuyente</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-2">
            {[
              { v: "trabajador", l: "Trabajador" },
              { v: "autonomo", l: "Autónomo" },
              { v: "sl", l: "SL (próximamente)", off: true },
            ].map((t) => (
              <button key={t.v} type="button" disabled={t.off}
                onClick={() => !t.off && upd("tipoContribuyente", t.v)}
                className={"rounded-md px-3 py-1.5 text-sm font-medium transition-colors " +
                  (t.off ? "cursor-not-allowed bg-stone-100 text-stone-400" :
                   (datos.tipoContribuyente || "trabajador") === t.v
                     ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-700 hover:bg-stone-200")}>
                {t.l}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-stone-500">
            {(datos.tipoContribuyente || "trabajador") === "autonomo"
              ? "Autónomo: introduce tu rendimiento neto anual (ingresos − gastos, incluida la cuota de autónomos). No aplica la bonificación de rendimientos de trabajo."
              : "Trabajador por cuenta ajena: introduce tu sueldo bruto; aplicamos cotizaciones (~6,5 %) y bonificación de trabajo."}
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Perfiles guardados</CardTitle>
          <CardDescription>
            Guarda tu situación con un nombre y recupérala en cualquier sesión. Los perfiles se
            almacenan de forma privada: solo tú puedes verlos.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <Input
              placeholder="Nombre del perfil (p. ej. «Nosotros 2026»)"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
            />
            <button type="button" onClick={guardar}
              className={btn + " shrink-0 bg-emerald-700 text-white hover:bg-emerald-800"}>
              Guardar perfil
            </button>
          </div>

          {perfiles === null && <p className="text-sm text-stone-500">Cargando perfiles…</p>}
          {perfiles !== null && nombres.length === 0 && (
            <p className="text-sm text-stone-500">Aún no hay perfiles: ponle nombre a tu situación y pulsa «Guardar perfil».</p>
          )}
          {nombres.length > 0 && (
            <ul className="space-y-2">
              {nombres.map((n) => (
                <li key={n}
                  className="flex items-center justify-between gap-2 rounded-md border border-stone-200 bg-white p-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-emerald-950">{n}</p>
                    <p className="text-xs text-stone-500">
                      Guardado el {new Date(perfiles[n].guardado).toLocaleDateString("es-ES")}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => cargar(n)}
                      className={btn + " bg-stone-100 text-emerald-900 hover:bg-stone-200"}>
                      Cargar
                    </button>
                    <button type="button" onClick={() => borrar(n)}
                      className={btn + " bg-red-50 text-red-700 hover:bg-red-100"}>
                      Eliminar
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {msg && <p className="text-sm text-emerald-900">{msg}</p>}
        </CardContent>
      </Card>

      {CAMPOS.map((g) => (
        <Card key={g.grupo}>
          <CardHeader>
            <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">{g.grupo}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              {g.campos.filter((c) => !c.sw).map((c) => (
                <div key={c.k} className="space-y-1">
                  <Label htmlFor={"md-" + c.k}>{c.l}</Label>
                  <Input id={"md-" + c.k} type="number" value={datos[c.k]} onChange={num(c.k)} />
                </div>
              ))}
            </div>
            {g.campos.filter((c) => c.sw).map((c) => (
              <div key={c.k} className="flex items-center justify-between gap-4">
                <Label htmlFor={"md-" + c.k} className="leading-snug">{c.l}</Label>
                <Switch id={"md-" + c.k} checked={datos[c.k]}
                  onCheckedChange={(v) => upd(c.k, v)} />
              </div>
            ))}
          </CardContent>
        </Card>
      ))}

      <Card>
        <CardHeader>
          <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Historial de eventos</CardTitle>
          <CardDescription>
            Todo cambio es un evento en un log inmutable; el estado de la app es su proyección.
            Guardar un perfil guarda el log completo; cargarlo lo reproduce. {eventos.length}{" "}
            {eventos.length === 1 ? "evento" : "eventos"} en esta sesión.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {eventos.length === 0 && (
            <p className="text-sm text-stone-500">Aún no hay eventos: cambia cualquier campo y aparecerá aquí.</p>
          )}
          {eventos.length > 0 && (
            <ul className="space-y-1">
              {eventos.slice(-8).reverse().map((ev) => (
                <li key={ev.id} className="rounded bg-stone-50 px-2 py-1 text-xs text-stone-600">
                  <span className="font-mono text-[10px] text-stone-400">{ev.type}</span>{" "}
                  · {resumirEvento(ev)}
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={deshacer} disabled={eventos.length === 0}
            className={"rounded-md px-3 py-1.5 text-xs font-medium " + (eventos.length === 0
              ? "cursor-not-allowed bg-stone-100 text-stone-400"
              : "bg-stone-100 text-emerald-900 hover:bg-stone-200")}>
            ⟲ Deshacer último evento
          </button>
        </CardContent>
      </Card>

      <p className="text-xs text-stone-400">
        Los cambios se aplican al instante en todas las pestañas. Guardar un perfil congela el log
        de eventos actual; cargarlo lo reproduce de forma determinista.
      </p>
    </div>
  );
}


/* ---------- Panel: read model consolidado (CQRS-lite sobre el mismo log) ---------- */

function selResumen(datos) {
  const tipoC = datos.tipoContribuyente || "trabajador";
  const epsvAplicada = epsvReducible(datos.epsv, datos.epsvEmpresa);
  const baseGeneral = baseLiquidableGeneral(datos.sueldoBruto, epsvAplicada, tipoC);
  const baseSin = baseLiquidableGeneral(datos.sueldoBruto, 0, tipoC);
  const cuotaDisp = cuotaDisponible(datos.sueldoBruto, epsvAplicada, tipoC);
  const excluido = datos.compraDesde2026 && (baseGeneral >= 68000 || datos.baseAhorro >= 68000);
  const creditoInicial = Math.max(0, CREDITO_MAX - 0.18 * datos.gananciaExenta - datos.creditoConsumido);
  const sim = simular({
    principal: datos.prestamo, interes: datos.interes, plazo: datos.plazo,
    metalicoInicial: datos.metalicoInicial, cuotaIntegra: cuotaDisp,
    edad: datos.edad, menor36: datos.menor36, colectivo23: datos.colectivo23,
    creditoInicial, excluidoPorBase: excluido, optimizar: true,
  });
  const viviendaAnio1 = sim.filas[0] ? sim.filas[0].aplicada : 0;
  const ahorroEpsv = epsvAplicada > 0 ? cuotaGeneral(baseSin) - cuotaGeneral(baseGeneral) : 0;
  const liq = liquidarVentas(datos.ventas || [], datos.otrasRentas);
  const margen = epsvReducible(EPSV_MAX_INDIVIDUAL, datos.epsvEmpresa);
  const jugadaEpsv = datos.compraDesde2026 && datos.baseAhorro < 68000 &&
    baseSin >= 68000 && baseSin - margen < 68000 &&
    epsvAplicada < Math.ceil(baseSin - 67999);
  const cartera = datos.cartera || [];
  const plusvalia = cartera.reduce(
    (s, p) => s + ((Number(p.actual) || 0) - (Number(p.compra) || 0)), 0);
  return {
    tipoC, viviendaAnio1, ahorroEpsv, ahorroAnual: viviendaAnio1 + ahorroEpsv,
    cuotaDisp, creditoInicial, excluido, jugadaEpsv,
    excedeLimite: liq.filas.some((f) => f.excede),
    liq, plusvalia, nVentas: (datos.ventas || []).length,
  };
}

function Panel({ datos, ir }) {
  const r = useMemo(() => selResumen(datos), [datos]);
  const alertas = [
    r.jugadaEpsv && { txt: "Jugada EPSV disponible: recupera la deducción de vivienda", tab: "epsv" },
    r.excluido && { txt: "Base ≥ 68.000 €: sin deducción de vivienda este ejercicio", tab: "calc" },
    r.excedeLimite && { txt: "Un ejercicio supera 10.000 € en cotizados: pierdes el 3 %", tab: "inv" },
    r.creditoInicial > 0 && r.creditoInicial < 7200 &&
      { txt: "Queda menos del 20 % del crédito vitalicio", tab: "calc" },
  ].filter(Boolean);

  const Fila = ({ titulo, dato, detalle, tab }) => (
    <div className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 bg-white p-3">
      <div className="min-w-0">
        <p className="text-sm font-medium text-emerald-950">{titulo}</p>
        <p className="truncate text-xs text-stone-500">{detalle}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <p className="font-display num text-lg font-semibold text-emerald-950">{dato}</p>
        <button type="button" onClick={() => ir(tab)}
          className="rounded-md bg-stone-100 px-2.5 py-1 text-xs font-medium text-emerald-900 hover:bg-stone-200">
          Abrir
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card className="border-emerald-900/20">
        <CardContent className="space-y-4 pt-5">
          <div className="text-center">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-stone-500">
              Ahorro fiscal identificado · ejercicio {ANIO_ACTUAL}
            </p>
            <p className="font-display num mt-1 text-5xl font-semibold tracking-tight text-emerald-950">
              {eur(r.ahorroAnual)}
            </p>
            <p className="mt-1 text-xs text-stone-500">
              {eur(r.viviendaAnio1)} de deducción por vivienda + {eur(r.ahorroEpsv)} por tus
              aportaciones a EPSV, con tu cuota disponible de {eur(r.cuotaDisp)}
            </p>
          </div>
          <DepositoForal disponible={r.creditoInicial} />
          {alertas.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {alertas.map((a) => (
                <button key={a.txt} type="button" onClick={() => ir(a.tab)}
                  className="rounded-full border border-amber-300 bg-amber-50 px-2.5 py-1 text-left text-xs font-medium text-amber-900 hover:bg-amber-100">
                  ⚠ {a.txt} →
                </button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-2">
        <Fila titulo="Vivienda" tab="calc"
          dato={eur(r.viviendaAnio1)}
          detalle={"Deducción aplicable en " + ANIO_ACTUAL + " con la estrategia optimizada"} />
        <Fila titulo="EPSV" tab="epsv"
          dato={eur(r.ahorroEpsv)}
          detalle="Ahorro de IRPF por tus aportaciones de este ejercicio" />
        <Fila titulo="Inversiones" tab="inv"
          dato={r.nVentas > 0 ? eur(r.liq.total) : eur(r.plusvalia)}
          detalle={r.nVentas > 0
            ? "Impuesto del plan de ventas en " + r.liq.filas.length + " ejercicios"
            : "Plusvalía latente de la cartera, sin plan de ventas aún"} />
      </div>

      <p className="text-xs text-stone-400">
        Todo lo que ves es una proyección del mismo log de eventos: cambia un dato en cualquier
        pestaña y este panel se recalcula al instante.
      </p>
    </div>
  );
}

/* ---------- Wiki ---------- */

const LeyItem = ({ nombre, desc, url }) => (
  <li className="rounded-md border border-stone-200 bg-white p-3 transition-colors hover:border-emerald-700/40">
    <p className="text-sm font-medium text-emerald-950">{nombre}</p>
    <p className="text-sm text-stone-600">{desc}</p>
    {url && (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="text-xs text-emerald-700 underline underline-offset-2"
      >
        Ver texto / fuente oficial
      </a>
    )}
  </li>
);

const WIKI = [
  {
    id: "marco",
    titulo: "Marco general: Concierto Económico y arquitectura foral",
    leyes: [
      {
        nombre: "Ley Orgánica 3/1979 — Estatuto de Autonomía del País Vasco (Estatuto de Gernika)",
        desc: "Su artículo 41 establece que las relaciones tributarias entre el Estado y el País Vasco se regulan por el sistema foral tradicional de Concierto Económico.",
        url: "https://www.boe.es/buscar/act.php?id=BOE-A-1979-30177",
      },
      {
        nombre: "Ley 12/2002 — Concierto Económico con la Comunidad Autónoma del País Vasco",
        desc: "Norma clave del sistema: atribuye a los tres territorios históricos la capacidad de mantener, establecer y regular su propio régimen tributario (impuestos concertados de normativa autónoma como IRPF, IS, Patrimonio o Sucesiones) y de exaccionar, gestionar e inspeccionar todos los impuestos. Modificada en varias ocasiones, la última por la Ley 3/2025, de 29 de abril.",
        url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-9969",
      },
      {
        nombre: "Ley 11/2017 — Metodología de señalamiento del Cupo (quinquenio 2017-2021)",
        desc: "Regula el Cupo: la aportación que el País Vasco paga al Estado por las competencias no asumidas. Es la contrapartida financiera del Concierto.",
        url: "https://www.boe.es/buscar/act.php?id=BOE-A-2017-15369",
      },
      {
        nombre: "Ley 27/1983 — Ley de Territorios Históricos (LTH)",
        desc: "Ley del Parlamento Vasco que reparte competencias entre las instituciones comunes (Gobierno Vasco) y los órganos forales de Álava, Bizkaia y Gipuzkoa, incluida la competencia tributaria de las Juntas Generales y Diputaciones Forales.",
        url: "https://www.legegunea.euskadi.eus/eli/es-pv/l/1983/11/25/27/dof/spa/html/webleg00-contfich/es/",
      },
      {
        nombre: "Ley 3/1989 — Armonización, coordinación y colaboración fiscal (OCTE)",
        desc: "Crea el Órgano de Coordinación Tributaria de Euskadi, que armoniza la normativa de los tres territorios para que las tres haciendas forales mantengan sistemas coherentes entre sí.",
        url: "https://www.legegunea.euskadi.eus/eli/es-pv/l/1989/05/30/3/dof/spa/html/webleg00-contfich/es/",
      },
    ],
  },
  {
    id: "bizkaia",
    titulo: "Bizkaia: normas forales principales",
    leyes: [
      {
        nombre: "Norma Foral 2/2005 — General Tributaria de Bizkaia",
        desc: "Equivalente foral de la Ley General Tributaria: principios, procedimientos, inspección, recaudación y sanciones en Bizkaia.",
        url: "https://www.bizkaia.eus/ogasuna",
      },
      {
        nombre: "Norma Foral 13/2013 — IRPF de Bizkaia",
        desc: "Regula el IRPF foral: tarifa propia, deducción por vivienda habitual (18 % / 23 %, crédito fiscal de 36.000 €), deducción por alquiler, reducciones por EPSV, etc.",
        url: "https://www.bizkaia.eus/ogasuna",
      },
      {
        nombre: "Norma Foral 11/2013 — Impuesto sobre Sociedades de Bizkaia",
        desc: "IS foral con tipos y deducciones propias (I+D+i, microempresas y pequeñas empresas, compensación de bases).",
        url: "https://www.bizkaia.eus/ogasuna",
      },
      {
        nombre: "Norma Foral 2/2013 — Impuesto sobre el Patrimonio",
        desc: "Patrimonio con mínimo exento y escala propios de Bizkaia.",
      },
      {
        nombre: "Norma Foral 4/2015 — Impuesto sobre Sucesiones y Donaciones",
        desc: "ISD foral: trato muy favorable a familiares directos (grupos I y II) frente al régimen común.",
      },
      {
        nombre: "Norma Foral 1/2011 — ITP y AJD",
        desc: "Transmisiones patrimoniales y actos jurídicos documentados, con tipos reducidos para vivienda habitual.",
      },
      {
        nombre: "Norma Foral 7/1994 — IVA",
        desc: "El IVA es un impuesto concertado de normativa común: Bizkaia lo gestiona y recauda, pero su contenido replica la ley estatal.",
      },
      {
        nombre: "DA 24.ª NF 13/2013 — Gravamen especial del 3 % en transmisión de valores cotizados",
        desc: "Régimen opcional: si el conjunto de valores admitidos a negociación transmitidos en el año es inferior a 10.000 €, puedes tributar al 3 % del valor de transmisión en lugar de por la ganancia real. La opción es expresa, todo o nada por ejercicio, y excluye fondos de inversión y derechos de suscripción.",
        url: "https://www.bizkaia.eus/ogasuna",
      },
      {
        nombre: "Norma Foral 2/2025, de 9 de abril — Revisión fiscal del sistema tributario de Bizkaia",
        desc: "Gran reforma con efectos desde 2025: extiende el tipo del 23 % en vivienda a menores de 36 años, familias numerosas y monoparentales; introduce el límite de base liquidable de 68.000 € para compras desde 2026; cuentas vivienda a 10 años; medidas de familia, empleo y fiscalidad verde.",
        url: "https://www.bizkaia.eus/ogasuna",
      },
      {
        nombre: "Norma Foral 7/2025 — Presupuestos de Bizkaia 2026 (+ DF 133/2025 y DF 134/2025)",
        desc: "Deflacta la tarifa del IRPF un 2 % para 2026, actualiza deducciones y reducciones, y aprueba las tablas de retenciones de 2026 y los reglamentos de IRPF e IS derivados de la NF 2/2025.",
      },
    ],
  },
  {
    id: "gipuzkoa",
    titulo: "Gipuzkoa: normas forales principales",
    leyes: [
      {
        nombre: "Norma Foral 2/2005 — General Tributaria de Gipuzkoa",
        desc: "Marco general de aplicación de los tributos en Gipuzkoa.",
        url: "https://www.gipuzkoa.eus/es/web/ogasuna",
      },
      {
        nombre: "Norma Foral 3/2014 — IRPF de Gipuzkoa",
        desc: "IRPF foral guipuzcoano, con estructura paralela a Bizkaia y Álava pero con diferencias puntuales en deducciones y límites.",
      },
      {
        nombre: "Norma Foral 2/2014 — Impuesto sobre Sociedades de Gipuzkoa",
        desc: "IS foral de Gipuzkoa.",
      },
      {
        nombre: "Norma Foral 1/2025, de 9 de mayo — Reforma del sistema tributario de Gipuzkoa",
        desc: "Reforma alineada con Bizkaia y Álava (familia, vivienda, empleo, fiscalidad verde): eleva a 20.000 € el límite para no declarar por rendimientos del trabajo, reducción por tributación conjunta de 4.800 €, deducciones trasladables 5 años, incentivos a previsión social de empleo.",
        url: "https://www.gipuzkoa.eus/es/web/ogasuna",
      },
      {
        nombre: "Decreto Foral-Norma 1/2025 y Decreto Foral 27/2025 (diciembre 2025)",
        desc: "Modificaciones tributarias de cierre de año y nuevas tablas de retenciones del trabajo para 2026.",
      },
    ],
  },
  {
    id: "alava",
    titulo: "Álava: normas forales principales",
    leyes: [
      {
        nombre: "Norma Foral 6/2005 — General Tributaria de Álava",
        desc: "Marco general tributario alavés.",
        url: "https://web.araba.eus/es/hacienda",
      },
      {
        nombre: "Norma Foral 33/2013 — IRPF de Álava",
        desc: "IRPF foral alavés.",
      },
      {
        nombre: "Norma Foral 37/2013 — Impuesto sobre Sociedades de Álava",
        desc: "IS foral alavés.",
      },
      {
        nombre: "Norma Foral 3/2025, de 9 de abril — Revisión de impuestos del sistema tributario de Álava",
        desc: "Reforma coordinada con Bizkaia y Gipuzkoa con efectos desde 2025 (familia, vivienda, empleo, previsión social, fiscalidad verde).",
      },
      {
        nombre: "Norma Foral 21/2025 — Medidas tributarias para 2026 (+ DNUF 2/2025)",
        desc: "Medidas fiscales para 2026 y adaptación de la normativa alavesa a la modificación del Concierto Económico por la Ley 3/2025.",
      },
    ],
  },
  {
    id: "claves",
    titulo: "Conceptos clave para el contribuyente",
    leyes: [
      {
        nombre: "Impuestos concertados de normativa autónoma",
        desc: "IRPF, IS, Patrimonio, Sucesiones e ITP: cada territorio histórico aprueba su propia regulación. Por eso las deducciones de Bizkaia (como el crédito fiscal de vivienda de 36.000 €) no existen igual en el régimen común.",
      },
      {
        nombre: "Impuestos concertados de normativa común",
        desc: "IVA e impuestos especiales: las haciendas forales los gestionan y recaudan, pero con el mismo contenido que la ley estatal.",
      },
      {
        nombre: "Punto de conexión: residencia habitual",
        desc: "Tributas a la hacienda foral del territorio donde tienes tu residencia habitual. Cambiar de residencia entre territorio común y foral cambia la normativa aplicable a tu IRPF.",
      },
      {
        nombre: "EPSV",
        desc: "Las Entidades de Previsión Social Voluntaria son el instrumento vasco de ahorro-jubilación: las aportaciones reducen la base imponible del IRPF foral.",
      },
    ],
  },
  {
    id: "fuentes",
    titulo: "Fuentes oficiales",
    leyes: [
      {
        nombre: "Hacienda Foral de Bizkaia",
        desc: "Normativa, guías (Gure Gida) y preguntas frecuentes.",
        url: "https://www.bizkaia.eus/ogasuna",
      },
      {
        nombre: "Hacienda Foral de Gipuzkoa",
        desc: "Normativa y servicios tributarios guipuzcoanos.",
        url: "https://www.gipuzkoa.eus/es/web/ogasuna",
      },
      {
        nombre: "Hacienda Foral de Álava",
        desc: "Normativa y servicios tributarios alaveses.",
        url: "https://web.araba.eus/es/hacienda",
      },
      {
        nombre: "BOE — Ley 12/2002 del Concierto Económico (texto consolidado)",
        desc: "Texto vigente del Concierto con todas sus modificaciones.",
        url: "https://www.boe.es/buscar/act.php?id=BOE-A-2002-9969",
      },
    ],
  },
];

function WikiFiscal() {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[15px] font-semibold tracking-tight text-emerald-950">Wiki: fiscalidad del País Vasco</CardTitle>
        <CardDescription>
          El País Vasco tiene un sistema tributario propio basado en el Concierto Económico: las
          haciendas forales de Álava, Bizkaia y Gipuzkoa regulan, gestionan y recaudan sus
          impuestos, y pagan al Estado el Cupo por las competencias no transferidas.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div className="space-y-2">
          {WIKI.map((sec) => (
            <details key={sec.id} className="group rounded-lg border border-stone-200 bg-stone-50">
              <summary className="flex cursor-pointer select-none items-baseline gap-1 p-3 text-sm font-medium text-emerald-950 hover:bg-stone-100">
                {sec.titulo}
              </summary>
              <ul className="space-y-2 p-3 pt-0">
                {sec.leyes.map((l) => (
                  <LeyItem key={l.nombre} {...l} />
                ))}
              </ul>
            </details>
          ))}
        </div>
        <p className="mt-4 text-xs text-stone-400">
          Resumen divulgativo actualizado a junio de 2026. Verifica siempre el texto vigente en las
          fuentes oficiales.
        </p>
      </CardContent>
    </Card>
  );
}

/* ---------- App ---------- */

export default function App() {
  const [tab, setTab] = useState("panel");
  // Event sourcing: el log de eventos es la única fuente de verdad;
  // `datos` es siempre su proyección determinista.
  const [eventos, setEventos] = useState([]);
  const datos = useMemo(() => proyectar(eventos, ESTADO_INICIAL), [eventos]);
  const emitir = (type, payload) =>
    setEventos((evs) => [...evs, { id: nuevoId(), ts: new Date().toISOString(), type, payload }]);
  const upd = (k, v) => emitir("CAMPO_FIJADO", { campo: k, valor: v });
  // Caso de uso: una decisión emite un lote de eventos con identidad común,
  // de modo que pueda compensarse entera (anulaciones), no truncando el log.
  const decidir = (type, lista) => {
    const decisionId = nuevoId();
    lista.forEach((p) => emitir(type, { ...p, decisionId }));
  };
  const deshacer = () => setEventos((evs) => evs.slice(0, -1));
  const tabCls = (v) =>
    "flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium " +
    (tab === v
      ? "bg-emerald-900 text-emerald-50 shadow-sm"
      : "text-stone-600 hover:bg-emerald-900/5 hover:text-emerald-950");
  return (
    <div className="min-h-screen px-4 py-6 text-[#22302a] sm:py-10" style={{ background: "#EFF2EB" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,500;9..144,600;9..144,700&family=Instrument+Sans:wght@400;500;600&display=swap');
        .raiz, .raiz input, .raiz select, .raiz button { font-family: 'Instrument Sans', system-ui, sans-serif; }
        .font-display { font-family: 'Fraunces', Georgia, serif; }
        .num, td[class~="text-right"], th[class~="text-right"] { font-variant-numeric: tabular-nums; }
        .raiz input[type=number] { text-align: right; font-variant-numeric: tabular-nums; }
        .raiz button { transition: background-color .15s ease, color .15s ease, transform .12s ease, box-shadow .15s ease; }
        .raiz button:not(:disabled):active { transform: scale(.985); }
        .raiz :is(button, input, select):focus-visible { outline: 2px solid #2A5A38; outline-offset: 2px; }
        .raiz details > summary { list-style: none; }
        .raiz details > summary::-webkit-details-marker { display: none; }
        .raiz details > summary::before { content: '+'; display: inline-block; width: 1.1em; color: #2A5A38; font-weight: 600; }
        .raiz details[open] > summary::before { content: '–'; }
        .gauge { background: linear-gradient(90deg, #173823, #2A5A38 60%, #3E7A4E); transition: width .5s cubic-bezier(.2,.8,.2,1); }
        @keyframes vista { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: none; } }
        .vista { animation: vista .24s ease both; }
        @media (prefers-reduced-motion: reduce) {
          .vista { animation: none; }
          .gauge { transition: none; }
          .raiz button { transition: none; }
        }
      `}</style>
      <div className="raiz mx-auto max-w-2xl space-y-4">
        <header className="flex items-start gap-3 pb-1">
          <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden="true" className="mt-1 shrink-0">
            <path d="M12 2c3 2.5 6 5 6 9a6 6 0 0 1-5 5.9V21a1 1 0 1 1-2 0v-4.1A6 6 0 0 1 6 11c0-4 3-6.5 6-9Z"
              fill="#2A5A38" />
            <path d="M12 6v9" stroke="#EFF2EB" strokeWidth="1.3" strokeLinecap="round" />
            <path d="M12 9.5c1.2-.4 2-.9 2.6-1.8M12 12.5c-1.2-.4-2-.9-2.6-1.8"
              stroke="#EFF2EB" strokeWidth="1.1" strokeLinecap="round" fill="none" />
          </svg>
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#B9821D]">
              Bizkaia · normativa foral 2026
            </p>
            <h1 className="font-display text-[28px] font-semibold leading-tight tracking-tight text-emerald-950">
              Optimizador fiscal foral
            </h1>
            <p className="mt-0.5 text-sm text-stone-600">
              Crédito de vivienda de {eur(CREDITO_MAX)}, regla del 3 %, EPSV y cartera — del texto
              foral a decisiones en euros.
            </p>
          </div>
        </header>

        <nav className="sticky top-2 z-20">
          <div className="flex w-full flex-wrap gap-1 rounded-xl border border-emerald-900/10 bg-white/85 p-1 shadow-sm backdrop-blur">
          <button type="button" className={tabCls("panel")} onClick={() => setTab("panel")}>
            Panel
          </button>
          <button type="button" className={tabCls("datos")} onClick={() => setTab("datos")}>
            Mis datos
          </button>
          <button type="button" className={tabCls("calc")} onClick={() => setTab("calc")}>
            Hipoteca
          </button>
          <button type="button" className={tabCls("epsv")} onClick={() => setTab("epsv")}>
            EPSV
          </button>
          <button type="button" className={tabCls("inv")} onClick={() => setTab("inv")}>
            Inversiones
          </button>
          <button type="button" className={tabCls("wiki")} onClick={() => setTab("wiki")}>
            Wiki
          </button>
          </div>
        </nav>
        <main key={tab} className="vista space-y-4">
          {tab === "panel" && <Panel datos={datos} ir={setTab} />}
          {tab === "datos" && <MisDatos datos={datos} upd={upd} eventos={eventos} setEventos={setEventos} deshacer={deshacer} />}
          {tab === "calc" && <Calculadora datos={datos} upd={upd} />}
          {tab === "epsv" && <TabEpsv datos={datos} upd={upd} emitir={emitir} />}
          {tab === "inv" && (
            <>
              <TabCartera datos={datos} upd={upd} emitir={emitir} decidir={decidir} />
              <Desinversiones datos={datos} upd={upd} emitir={emitir} />
            </>
          )}
          {tab === "wiki" && <WikiFiscal />}
        </main>

        <footer className="flex items-center justify-between border-t border-emerald-900/10 pt-3 text-[11px] text-stone-500">
          <span>Motor validado: 63 comprobaciones contra fuentes oficiales</span>
          <span>Orientativo · no es asesoramiento fiscal</span>
        </footer>
      </div>
    </div>
  );
}
