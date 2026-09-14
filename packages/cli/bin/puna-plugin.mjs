#!/usr/bin/env node
/**
 * puna-plugin CLI entrypoint. Re-exports src/index.ts after Fase 7 wiring.
 */
import('../src/index.js').then(m => {
  console.log(`puna-plugin ${m.CLI_VERSION} (Fase 0 stub — commands land in Fase 7)`);
});