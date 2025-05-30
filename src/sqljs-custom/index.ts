// Custom sql.js build with FTS5 support
// This wrapper provides a clean interface to our custom sql.js build

// Import types from sql.js for TypeScript support
import { Database, SqlJsStatic } from 'sql.js';

// Re-export the types for TypeScript compatibility
export { Database, SqlJsStatic };

// Import and re-export the initialization function
// We use require because the custom build expects a CommonJS environment
const initSqlJs = require('./sql-wasm.js');

// Export as both named and default export for compatibility
export { initSqlJs };
export default initSqlJs; 