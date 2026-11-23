// Les fichiers .gpx sont inclus comme texte par esbuild (voir web/build.mjs).
declare module '*.gpx' {
  const text: string;
  export default text;
}
