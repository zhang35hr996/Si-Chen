/**
 * Load the real shipped content/ once for engine tests.
 * The loader itself lives in a non-test module (tools/lib) so production tools
 * don't depend on tests/; this re-export keeps the established test import path.
 */
export { loadRealContent } from "../../tools/lib/loadRealContent";
