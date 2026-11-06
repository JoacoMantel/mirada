# Mirada

Página web para escribir con la mirada desde el celular, usando la cámara frontal. Funciona en el navegador, sin instalar nada. El video se procesa en el dispositivo y no se envía a ningún servidor.

## Cómo usarla

1. Apoyá el celular en vertical sobre un soporte, a la altura de la cara y a unos 30 cm.
2. Tocá **Activar la cámara** y dale permiso.
3. Tocá **Calibrar** y seguí los puntos con la mirada.
4. Mirá una opción durante un momento para elegirla. Para descansar, mirá la parte de arriba, donde está el texto.

Desde **Ajustes** podés cambiar el tiempo de mirada, ver dónde detecta la mirada y volver a calibrar.

## Publicarla con GitHub Pages

En el repositorio: **Settings → Pages → Deploy from a branch → main → / (root) → Save**. La cámara necesita HTTPS, y GitHub Pages ya lo usa.

## Probarla en tu computadora

```
python3 -m http.server 8000
```

Después abrí `http://localhost:8000`. Abrir `index.html` directamente como archivo no funciona.

## Archivos

- `js/predictor.js`: letras y palabras probables en español.
- `js/gaze.js`: rasgos de los ojos, calibración, suavizado y tiempo de mirada.
- `js/app.js`: pantallas, cámara y teclado.
- `js/words.js`: lista de palabras, generada con [wordfreq](https://github.com/rspeer/wordfreq).
- `vendor/face_mesh`: [MediaPipe Face Mesh](https://www.npmjs.com/package/@mediapipe/face_mesh) 0.4.1633559619 (Apache-2.0).
- `vendor/font`: Atkinson Hyperlegible (SIL OFL 1.1).
