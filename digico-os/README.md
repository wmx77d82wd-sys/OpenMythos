# DigiCo Quantum OS

Escritorio en el navegador donde instalas tus propias apps. Abre `index.html` (doble clic) o sírvelo con cualquier servidor estático para poder instalarlo como PWA y usarlo sin conexión.

## Estructura
```
index.html        shell + metadatos PWA
styles.css        estilos (tema claro/oscuro, acento configurable)
js/core.js        estado, sistema de archivos virtual, ventanas, paleta Ctrl+K, menú contextual, fondo
js/qubit.js       Qubit Lab (simulador de hasta 5 qubits, exporta OpenQASM 3)
js/services.js    Asistente IA (Anthropic) y Nube (Supabase)
js/apps.js        Notas, Archivos, Editor, Builder, Mis Apps, Ajustes, Terminal, API `os` para apps
js/main.js        arranque, escritorio, menú Inicio, restauración de sesión
sw.js, manifest.webmanifest, icon.svg   PWA
sync.sql          tabla y políticas RLS de Supabase
desktop/          envoltorio Electron (archivos reales y shell)
tests/smoke.js    pruebas de humo con Playwright (`npm test`)
```

## Qué puedes hacer
- **Ctrl/⌘ + K**: paleta para abrir apps, archivos y acciones. Clic derecho en el escritorio o en un ícono abre un menú.
- **Ventanas**: arrastra, redimensiona, doble clic en la barra para maximizar, arrastra a un borde para acoplar (izq./der./arriba). Al recargar se reabren las que tenías.
- **Archivos**: carpetas, renombrar, subir y descargar, vista previa de imágenes. Todo vive en `localStorage` (~5 MB); Ajustes muestra el uso y avisa si no hay espacio.
- **Agregar App / Asistente IA**: instala apps HTML/JS (plantillas incluidas) o una URL https. Corren en un iframe aislado y usan `window.os`: `os.notify(txt)`, `os.fs.read/write/list/remove(ruta)` dentro de `/apps/<id>/`.
- **Qubit Lab**: 2–5 qubits, puertas H X Y Z S T con controles (CNOT, Toffoli…), el color de cada barra es la fase, ×1000 mediciones, y **QASM** guarda `/circuits/circuito.qasm`.
- **Nube**: ejecuta `sync.sql` en tu proyecto Supabase; en la app pon URL, anon key, correo y contraseña. Cada usuario solo ve su fila.
- **Escritorio**: `cd desktop && npm install && npm start`. Añade `host ls|cat|write|rm` (carpeta real `~/DigiCoOS`) y `sh <comando>` a la terminal.

## Seguridad
- Las apps de terceros no comparten origen con el OS (iframe `sandbox` sin `allow-same-origin`) y solo ven su carpeta.
- Nombres e íconos de apps nunca se insertan como HTML. Los respaldos importados y la copia de la nube se validan antes de aplicarse.
- La API key de Anthropic se guarda en texto plano en el `localStorage` de este navegador; usa una clave con límite de gasto y pulsa «Olvidar clave» si compartes el equipo.
- `sh` ejecuta comandos reales; solo la terminal del OS (no las apps) puede usarlo.
