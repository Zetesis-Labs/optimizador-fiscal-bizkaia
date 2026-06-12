# Optimizador fiscal foral · Bizkaia

Herramienta para planificar y optimizar la fiscalidad de una persona física residente en
**Bizkaia** con la normativa foral de **2026**. Cubre cuatro decisiones reales y cómo encajan
entre sí:

- **Hipoteca + crédito de vivienda.** Simula la amortización y optimiza el crédito fiscal
  vitalicio de 36.000 € (deducción del 18 % / 23 %), con el límite anual de 8.500 €, el techo de
  cuota íntegra, los traslados a 5 ejercicios para menores de 36 y la exclusión por base liquidable
  ≥ 68.000 €.
- **EPSV.** Aportaciones individuales y empresariales (límites 5.000 / 8.000 / 10.000 €), ahorro de
  IRPF por nivel de aportación, la jugada del umbral de 68.000 € y un optimizador de rescate con el
  régimen 2026.
- **Inversiones (cartera + desinversión).** Acciones, ETFs y fondos; comparador del régimen general
  frente al **gravamen especial del 3 %** (DA 24.ª), con alerta del límite de 10.000 € por ejercicio
  y un plan plurianual que trocea las ventas por años fiscales.
- **Panel.** Un resumen consolidado del ahorro fiscal identificado y alertas accionables.

> Herramienta orientativa de divulgación. **No es asesoramiento fiscal.** Verifica siempre el
> texto vigente en la Hacienda Foral de Bizkaia.

## Arquitectura

La aplicación está construida sobre **event sourcing**: un log de eventos inmutable es la única
fuente de verdad y el estado de la interfaz es una **proyección determinista** de ese log
(`proyectar(eventos)`). Las decisiones complejas (como aplicar un plan de ventas) se emiten como
lotes de eventos con identidad propia y se revierten con eventos compensatorios, no truncando el
historial. Los perfiles guardan el log completo y al cargarlos se reproduce.

El cálculo fiscal vive aislado en `src/lib/engine.js` (funciones puras: escalas, deducción de
vivienda, EPSV, liquidación de plusvalías y el reductor de eventos), lo que permite validarlo de
forma independiente de la interfaz.

## Validación

El motor se valida contra **fuentes oficiales** con una suite de 155 comprobaciones:

```bash
npm test
```

Cobertura destacada (marcada `[OFICIAL]` en la suite):

- Escalas 2026 del ahorro (NF 2/2025) y general (NF 7/2025), contrastadas contra la columna de
  cuotas publicada, tramo a tramo.
- El ejemplo resuelto de deducción de vivienda de la guía Gure Gida de la Hacienda Foral, reproducido
  al céntimo.
- Los límites de aportación a EPSV y la frontera de la regla del 3 % (la DA 24.ª exige que el valor
  de transmisión sea *inferior* a 10.000 €).

Las aproximaciones del modelo (cotización social, bonificación de rendimientos de trabajo,
simplificación del autónomo) se marcan `[MODELO]` y se validan por coherencia, no como cifras
oficiales exactas.

## Desarrollo

```bash
npm install
npm run dev      # servidor de desarrollo
npm run build    # build de producción
npm test         # suite de validación fiscal
```

Stack: React 18 + Vite + Tailwind CSS. Los componentes de UI son una versión mínima del estilo
shadcn/ui en `src/components/ui`.

## Fuentes

- NF 13/2013 del IRPF de Bizkaia (texto consolidado) — escalas, deducciones, DA 24.ª
- NF 2/2025, de revisión fiscal — escala del ahorro 19–28 %, límite de 68.000 €
- NF 7/2025, de Presupuestos 2026 — tarifa general deflactada, minoración de cuota
- Guía Gure Gida de la Hacienda Foral de Bizkaia — ejemplo resuelto de deducción de vivienda
