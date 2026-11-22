// Tailwind build config. The game no longer loads Tailwind from a CDN at run time: run this once after changing classes
//   npx tailwindcss@3.4.17 -c tailwind.config.js -i tailwind.src.css -o tw.css --minify
// It scans these files for every class name used (including ones written inside JavaScript strings).
module.exports = {
  content: ['./index.html', './*.js', './spinners/*.js', '!./game.js.orig', '!./tailwind.config.js'],
  theme: { extend: {} },
  plugins: [],
};
