# Mirada

Página web para escribir con la mirada desde el celular, usando la cámara frontal. Funciona en el navegador, sin instalar nada. El video se procesa en el dispositivo y no se envía a ningún servidor.

## Cómo usarla

1. Sostené el celular en vertical frente a la cara, a unos 30 cm. También se puede usar un soporte.
2. Tocá **Activar la cámara** y dale permiso.
3. Tocá **Calibrar** y seguí los puntos con la mirada. Si lo vas a usar en la mano, mové el celular despacio durante la calibración.
4. Mirá una opción durante un momento para elegirla. Para descansar, mirá la parte de arriba, donde está el texto.

Si el celular cambió mucho de posición y empieza a elegir mal, tocá **Recentrar** y mirá el punto.

Desde **Ajustes** podés cambiar el tiempo de mirada, ver dónde detecta la mirada, copiar el texto y volver a calibrar.

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
