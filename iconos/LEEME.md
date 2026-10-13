# Los iconos de ETAAX

Esta carpeta es **la fuente**. Un archivo `.svg` por icono; el nombre del
archivo es el nombre del icono (`asesor.svg` → se pide como `'asesor'`).

```
node iconos/generar.js
```

Eso normaliza lo que haya aquí y lo mete en `/etaax-iconos.js`, que es lo que
cargan las pantallas. Agregar un icono es soltar el archivo y correr esa línea.

## El tamaño de tu mesa de trabajo da igual

720 × 720, 24 × 24, lo que te acomode. Un SVG es vectorial: **ese número nunca
llega al CSS**. El icono se escala al tamaño que pida cada pantalla
(`etaaxIcono('asesor', { tam: 20 })`), y el archivo solo aporta el dibujo.

Lo que sí conviene, por estética y no por técnica: **dejar el mismo margen en
todos**. Si uno llena la mesa de trabajo hasta el borde y otro deja aire
alrededor, al ponerlos juntos uno se verá más grande, aunque los dos midan 20
píxeles.

## Las dos únicas reglas

1. **Sin colores escritos.** El trazo se hereda del texto que lo rodea — por eso
   la misma flecha se ve sobre el botón verde y sobre el fondo oscuro. Si tu
   exportador escribe el crema `#f0ece4`, el generador lo quita.
2. **El detalle verde, con el verde de la marca** (`#3dbe7a`). El generador lo
   reconoce y lo marca solo: `etx-punto` cuando es relleno (el punto del
   usuario, la pupila) y `etx-trazo` cuando es una línea. Así, el día que cambie
   el verde, cambian todos.

Lo demás lo resuelve el generador: si tu dibujo está sobre un grid de 24 lo deja
como símbolo limpio; si no, conserva tu lienzo y tus transformaciones **tal
cual**, y el icono se ve exactamente como lo dibujaste — girado, con margen, lo
que sea.

Solo hay dos cosas que no puede usar: un archivo **sin un solo trazo**, y uno
**sin `viewBox`** (sin eso no hay manera de saber de qué tamaño es su lienzo).

## Cómo se usan

```js
elemento.innerHTML = etaaxIcono('asesor');            // 24 px
elemento.innerHTML = etaaxIcono('arrow', { tam: 20 });
```

Nunca se escribe `<use href="#etx-...">` a mano en el HTML: el sprite se
inyecta al cargar la página, y un `<use>` que apunta a algo que todavía no
existe puede no aparecer nunca.

## Lo que todavía no sale de aquí

Los otros 13 iconos siguen viniendo de las dos maquetas HTML del repo
`iconos-etaax`. Conforme Edwin vaya soltando los `.svg` definitivos aquí, cada
uno reemplaza al provisional. El candado avisa si un `.svg` cambia y nadie
regenera.
