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
import noInlineFontSize from "./no-inline-font-size.mjs";
import noDefaultTextSize from "./no-default-text-size.mjs";
import noRawColors from "./no-raw-colors.mjs";

const plugin = {
  meta: { name: "local", version: "0.1.0" },
  rules: {
    "no-sequential-db-await": noSequentialDbAwait,
    "no-await-in-layout": noAwaitInLayout,
    "no-router-refresh": noRouterRefresh,
    "no-eager-heavy-import": noEagerHeavyImport,
    "no-inline-font-size": noInlineFontSize,
    "no-default-text-size": noDefaultTextSize,
    "no-raw-colors": noRawColors,
  },
};

export default plugin;
