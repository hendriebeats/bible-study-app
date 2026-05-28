/**
 * Local ESLint plugin: rules that enforce repo-specific patterns that the
 * standard ecosystem doesn't cover. Wired in `eslint.config.mjs` under the
 * `local/` namespace.
 *
 * Each rule has a dedicated file with usage docs in its header comment.
 */

import noSequentialDbAwait from "./no-sequential-db-await.mjs";
import noAwaitInLayout from "./no-await-in-layout.mjs";
import noRouterRefresh from "./no-router-refresh.mjs";
import noEagerHeavyImport from "./no-eager-heavy-import.mjs";

const plugin = {
  meta: { name: "local", version: "0.1.0" },
  rules: {
    "no-sequential-db-await": noSequentialDbAwait,
    "no-await-in-layout": noAwaitInLayout,
    "no-router-refresh": noRouterRefresh,
    "no-eager-heavy-import": noEagerHeavyImport,
  },
};

export default plugin;
