declare module "*.md" {
    const content: string;
    export default content;
}

// Type declarations for sql.js-fts5
declare module "sql.js-fts5" {
    export * from "sql.js";
    export { default } from "sql.js";
    export { Database, SqlJsStatic } from "sql.js";
}
