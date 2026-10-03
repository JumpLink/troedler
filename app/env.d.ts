// Blueprint templates are XML strings at build time: `gjsify build` runs
// `@gjsify/vite-plugin-blueprint` over every `.blp` import and hands
// `GObject.registerClass` the compiled template instead of a path. TypeScript
// needs to be told that, or it reports every template import as a missing
// module — which is the whole cost of this file.
declare module '*.blp' {
  const content: string;
  export default content;
}
