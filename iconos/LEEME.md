# Los iconos de ETAAX

Esta carpeta es **la fuente**. Un archivo `.svg` por icono; el nombre del
archivo es el nombre del icono (`asesor.svg` → se pide como `'asesor'`).

```
node iconos/generar.js
```

Eso normaliza lo que haya aquí y lo mete en `/etaax-iconos.js`, que es lo que
cargan las pantallas. Agregar un icono es soltar el archivo y correr esa línea.

## Las reglas

1. **Lienzo de 24×24.** El dibujo tiene que estar sobre ese grid. Si tu
   exportador lo envuelve en un lienzo de 720 con una escala encima, no pasa
   nada: el generador lo entiende y lo desenvuelve, siempre que las coordenadas
   de dentro sean las del grid de 24.
2. **Sin colores escritos.** El trazo se hereda del texto que lo rodea — por eso
   la misma flecha se ve sobre el botón verde y sobre el fondo oscuro. Si tu
   exportador escribe el crema `#f0ece4`, el generador lo quita.
3. **El detalle verde, marcado.** Si lo exportas con el verde de la marca
   (`#3dbe7a`), el generador lo reconoce y lo marca solo: `etx-punto` cuando es
   relleno (el punto del usuario, la pupila) y `etx-trazo` cuando es una línea.
4. **Sin rotar ni estirar.** Si el icono viene girado o con escalas distintas en
   X y Y, el generador **se niega** y te dice por qué. Más vale no generar que
   generar un icono torcido: desenvolverlo lo movería de sitio y nadie lo
   notaría hasta verlo en pantalla.

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
