# Flat-block schema rewrite (Phases 1–5)

## Why

The current schema structurally nests lists (`bullet_list → list_item →
paragraph`). That nesting forces every drag/conversion operation to either
split-around-the-cursor or refuse-because-schema, producing the user-visible
"silent failure" bugs we've been hunting. A Notion-style flat schema —
where every block is a top-level sibling carrying its own `listType` and
`indent` attributes — removes the entire class of bug at the root and makes
drag-and-drop a pure attribute edit.

## Target shape

```
doc
└── block+        // all top-level — no structural list wrappers
    ├── paragraph     { indent: 0..15, listType: "none"   }
    ├── heading       { indent: 0..15, listType: "none", level: 1..6 }
    ├── list_row      { indent: 0..15, listType: "bullet" | "ordered" | "task",
    │                   checked?: boolean, listStart?: number }
    │                  content: "inline*"   ← like a paragraph
    ├── code_block    { indent: 0..15, listType: "none"   }
    ├── horizontal_rule
    ├── blockquote    { indent: 0..15 }   content: "block+"
    ├── callout       { indent: 0..15, variant }
    ├── collapsible   { indent: 0..15, open }
    ├── study_block   (unchanged)
    ├── note_entry    (unchanged)
    └── notes_index   (unchanged)
```

Key moves:

- **`list_item` / `task_item` → `list_row`** (one node, attr-discriminated).
- **`bullet_list` / `ordered_list` / `task_list` → gone.** Contiguous
  same-type `list_row` siblings are grouped visually by CSS, not structurally.
- **`indent` attr lives on (almost) every block.** Tab/Shift-Tab just edits
  it. No more `sinkListItem` / `liftListItem`.
- **Wrappers (`blockquote` / `callout` / `collapsible`) stay**, but their
  _content_ becomes flat-block siblings too. So a paragraph at indent 2
  inside a callout renders exactly like a paragraph at indent 2 outside it.

## What stays the same

- `study_block`, `note_entry`, `notes_index`, `verse_number`, `scripture` —
  no structural change. They're domain-specific and already flat-ish.
- All marks. All inline atom rules. The verse-guard plugin.
- The editor host (`document-editor.tsx`) — only the plugin set changes.

## Migration

One-time SQL migration, `pg_temp` style (no permanent function in the
catalog, matching the collapsible migration we already shipped):

```sql
-- For each of the 4 PMDoc JSONB columns, walk the JSON, transform
-- nested list nodes to flat list_row siblings, propagate listType+indent.

create or replace function pg_temp.flatten_lists(j jsonb, base_indent int) ...
  -- Recurses into 'content' arrays. When it sees a bullet_list/ordered_list/
  -- task_list, it inlines the children at base_indent+1 with the appropriate
  -- listType. list_item/task_item become list_row, taking the listType from
  -- the surrounding list. checked stays on task rows. order on ordered lists
  -- propagates as listStart on the first row, then implicit numbering.

update public.documents set content = pg_temp.flatten_lists(content, 0)
  where content @? '$.** ? (@.type == "bullet_list" || @.type == "ordered_list"
                            || @.type == "task_list")';
update public.section_checkpoints set doc = pg_temp.flatten_lists(doc, 0) ...;
update public.studies set template_blocks_doc = pg_temp.flatten_lists(...) ...;
update public.genre_block_templates set default_content = (
  pg_temp.flatten_lists(jsonb_build_object('content', default_content), 0)
)->'content' ...;
```

Step log:

```sql
-- Reset per-doc step logs. Checkpoints stay; intra-checkpoint undo before
-- the migration is lost (user-confirmed acceptable).
truncate table public.document_steps;
```

The function is dropped at session end (pg_temp). Nothing about the
migration leaks into the runtime codebase.

## Cutover plan

1. **Phase 1a (this doc).** Sign-off on the target shape + migration.
2. **Phase 1b.** Add the new schema (additive — keep old node types
   registered as deprecated aliases so any cached step that escaped the
   truncate still deserializes). Migrate. Verify existing docs render with
   the OLD plugin set still wired (no behavior change yet — schema's new
   nodes aren't used yet). Run the Playwright baseline suite, expect green.
3. **Phase 2.** Replace `bullet_list`/etc. with `list_row` in input rules,
   slash menu, toolbar, keymap. Rewrite `indentSelected` to attr-only.
   Rewrite smart-Enter to continue `listType`/`indent` on a new row.
4. **Phase 3.** NodeView for `list_row` (renders marker based on
   `listType`). CSS for contiguous-row visual grouping.
5. **Phase 4.** Block handles on every editable block. Pointer-reorder with
   horizontal-depth indicator. Drop = set `indent` + reorder position.
   Playwright drag matrix.
6. **Phase 5.** Remove the deprecated wrapper node types from schema. Final
   cleanup.

Each phase is independently mergeable + verifiable. The baseline Playwright
suite in `e2e/editor/` guards each cutover.

## Open questions left for the next sign-off

- Whether `blockquote` / `callout` / `collapsible` themselves get an
  `indent` attr (yes, for consistency) — confirm at start of Phase 1b.
- Whether `code_block` shows a list marker when its `listType` is bullet
  (probably no — overlay would clash with monospace gutter). Confirm.
- Whether the visual list "start a new run" trigger fires on `listStart`
  change OR on any attr change (matters for keyboard navigation across
  groups). Decide at Phase 3.
