# Plantillas de guía — cuál es cuál

Hay **dos formatos distintos** y se confunden fácil. Esto es para no volver a
bajar la equivocada.

## 1. Las guías de uso (las que ya existen) — formato presentación

`guia-portada.svg` y `guia-paso.svg`

Es el formato de los PDF que ya tienes hechos: `etaax-agregar-gasto-fijo.pdf`,
`etaax-corte-del-dia.pdf`, etc. **Fondo oscuro, 960 × 720 pt (horizontal)**, una
página por paso con su captura de pantalla.

Están reconstruidas **a escala del PDF real**: mismo lienzo, mismo margen de 54,
mismos colores y los mismos cuerpos de texto, medidos sobre el archivo. Si pones
una al lado de una guía ya hecha, coinciden.

**Para hacer una guía nueva:**

1. Duplica `guia-portada.svg` → cambia antetítulo, título (dos renglones), la
   bajada y los nombres de las tres fases.
2. Duplica `guia-paso.svg` **una vez por paso** → cambia la fase, el número, el
   título, el párrafo y mete las capturas en sus marcos.
3. Exporta todo a PDF en un solo documento y súbelo en
   *Aprende y Analiza → Guías de uso*.

## 2. La ficha de una hoja — formato impreso

`guia-a4-para-imprimir.svg`

**A4 vertical (595.28 × 841.89 pt), fondo crema.** Es otra cosa: una sola hoja
para colgar en cocina o en el pase. Fondo claro a propósito — en oscuro se come
el tóner y se lee peor bajo la luz del pase.

---

## Lo que vale para las tres

* Cada bloque es un `<g>` con nombre: en Illustrator y en Affinity aparecen en
  el panel de capas como lo que son, no como "Group 47".
* El texto es **vivo**, no contornos: se reescribe tal cual.
* Sin filtros, sin máscaras, sin clip-paths — es lo que sobrevive a ir y venir
  entre programas.
* **Fuentes:** display Bebas Neue, texto DM Sans. Si no las tienes instaladas,
  caen a Arial Narrow Bold y Arial — que son justo las que quedaron incrustadas
  en los PDF que ya hiciste, así que se ve prácticamente igual.
* El logotipo de la portada es el archivo de marca de verdad
  (`marca/etaax-logo-oscuro.svg`) incrustado, no una imitación con tipografía.
