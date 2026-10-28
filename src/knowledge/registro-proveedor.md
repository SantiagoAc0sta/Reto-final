# Registro como proveedor

Periferia IT Group recibe solicitudes de clientes para darse de alta como proveedor. La analista prepara el formulario y los soportes. El representante legal firma. Una persona decide el envío. El agente no firma, no envía y no escribe en portales.

## Fuentes

- La solicitud está en `fixtures/reto-01/casos/<caso>/solicitud.json`.
- La plantilla Excel está en `plantilla-celdas.json` con hoja, celda de la etiqueta, etiqueta y celda del valor.
- La plantilla PDF o de portal está en `plantilla-campos.json`, con etiqueta y si el campo es obligatorio, en el orden que debe reproducirse.
- Los soportes exigidos están en `soportes-exigidos.json`.
- Los datos oficiales están solo en `fixtures/reto-01/repositorio/maestro.json`.
- Los sinónimos de etiquetas están en `fixtures/reto-01/glosario-campos.json`.
- El índice de soportes está en `fixtures/reto-01/repositorio/soportes/index.json`.

## Identificador tributario

Periferia solo tiene NIT de Colombia. El equivalente que pide cada país del cliente es: CO NIT, EC RUC, PE RUC, PA RUC, HN RTN. Si el cliente no es de Colombia, el formulario se llena con el NIT colombiano y el campo queda en `requiere_confirmacion` con la nota "identificador extranjero". Una etiqueta genérica como "Identificación tributaria" o "Número de identificación fiscal" también queda en `requiere_confirmacion` y se propone el equivalente del país. El valor de País en el formulario es el país del proveedor que está en el maestro, no el país del cliente.

## Estados de un campo

- `lleno`: hay una clave del glosario y un valor en el maestro, con confianza de al menos 0.8.
- `faltante`: no hay clave o no hay valor. No se inventa.
- `requiere_confirmacion`: la confianza es menor a 0.8, la etiqueta es ambigua o aplica la regla del identificador extranjero.

Un campo faltante no impide `listo_para_firma`. Se lista en el checklist.

## Soportes

Un soporte se copia al paquete si el archivo existe en el repositorio. Si `vigencia_hasta` es una fecha anterior al día local de ejecución, está vencido. Si `vigencia_hasta` es null, no vence. Una fecha igual a la del día de ejecución sigue vigente. Un soporte exigido vencido o ausente bloquea `listo_para_firma`.

## Datos bancarios

Solo se escriben en el formulario cuando la plantilla trae una etiqueta bancaria. No van en `borrador-correo.md`, ni en `ENVIO-SIMULADO.md`, ni en el resumen del chat.

## Formatos

- `xlsx`: cada etiqueta y su valor se escriben en la hoja y la celda indicadas. Salida: `out/<caso>/formulario.xlsx`.
- `pdf`: se genera un PDF con todas las etiquetas y valores, en el orden de la plantilla. Salida: `out/<caso>/formulario.pdf`.
- `portal`: no se automatiza. Se responde "formato no soportado" y se escribe `out/<caso>/valores-portal.md` para copiar y pegar.

## Cierre

El paquete queda en `out/<caso>/paquete/` con el formulario, las copias de los soportes existentes, `checklist.md` y `borrador-correo.md`. El envío simulado solo existe después de una confirmación explícita del usuario en el turno anterior y únicamente crea `out/<caso>/ENVIO-SIMULADO.md`.

## Errores

Plantilla corrupta, caso inexistente o formato no reconocido: explicar el problema en una frase, sin traza técnica, y seguir con el reporte de faltantes cuando los datos alcancen. Ninguna herramienta lanza una excepción hacia el agente: responde `{ ok: true, data }` o `{ ok: false, error }`.
