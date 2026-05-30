// Minimal Deno globals + URL-import wildcard for the edge functions.
// Real Deno typings come from the deno-lsp VS Code extension; this file
// exists so the Node-based eslint projectService can parse these files
// under supabase/functions/tsconfig.json without "Deno is not defined" or
// "Cannot find module 'https://...'" errors.

declare const Deno: {
  serve(handler: (req: Request) => Response | Promise<Response>): void;
  env: { get(key: string): string | undefined };
};

// `@supabase/supabase-js` is loaded via URL in Deno but the package is also
// installed in the root node_modules. Re-export the npm types so the URL
// import resolves to the real `SupabaseClient` rather than `any`.
declare module "https://esm.sh/@supabase/supabase-js@2.45.4" {
  export * from "@supabase/supabase-js";
}

// Catch-all for any other URL imports added later — keep `any` so the
// edit doesn't fail the build the moment a new URL is referenced, with a
// reminder to add a precise re-export above when type coverage matters.
declare module "https://esm.sh/*";
declare module "https://deno.land/*";
