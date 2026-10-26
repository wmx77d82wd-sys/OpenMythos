# DigiCo Quantum OS

Escritorio en el navegador donde instalas tus propias apps. Abre `index.html` y listo.

- **Archivos / API `os`**: sistema de archivos virtual; tus apps usan `os.fs.*` y `os.notify()` dentro de `/apps/<id>/`.
- **Qubit Lab**: hasta 5 qubits; arrastra puertas (H X Y Z S T y ● control) a la rejilla.
- **Asistente IA**: pega tu API key de Anthropic (solo se guarda en tu navegador) y describe la app que quieres.
- **Nube**: sincroniza con Supabase. Ejecuta `sync.sql` en tu proyecto, y en la app pon URL, anon key, correo y contraseña.
- **Escritorio**: `cd desktop && npm install && npm start`. Añade `host ls|cat|write|rm` (carpeta real `~/DigiCoOS`) y `sh <comando>` en la terminal.

Nota: `sh` ejecuta comandos reales de tu equipo. Solo la terminal del OS lo puede usar, las apps instaladas no.
