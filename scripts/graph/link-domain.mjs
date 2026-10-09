#!/usr/bin/env node
// Adds RouteVerde-specific edges to graphify-out/graph.json after graphify builds it.
// Graphify's AST pass sees TypeScript and SQL separately; this joins them:
//   1. one canonical node per Postgres table/view, linked to every migration that
//      creates or alters it and to every code symbol that reads or writes it
//      (Kysely selectFrom/insertInto/updateTable/deleteFrom and raw sql`` templates);
//   2. one node per PRD requirement ID (FR-TEC-01, CR-01, ENG-06, ...), placed under
//      its PRD section and linked from every symbol whose code cites it.
// Local only: reads files, rewrites graph.json, never calls a network service.
// Idempotent: everything it added on a previous run is removed first.
import { readFileSync, writeFileSync, existsSync, appendFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const OUT = join(ROOT, "graphify-out");
const GRAPH = join(OUT, "graph.json");
const REPORT = join(OUT, "GRAPH_REPORT.md");
const ORIGIN = "routeverde-link";
const PRD = "docs/PRD.md";

if (!existsSync(GRAPH)) {
  console.error("[graph] no graphify-out/graph.json; run npm run graph first");
  process.exit(1);
}

const graph = JSON.parse(readFileSync(GRAPH, "utf8"));
graph.nodes = graph.nodes.filter((n) => n._origin !== ORIGIN);
graph.links = graph.links.filter((l) => l._origin !== ORIGIN);

const byId = new Map(graph.nodes.map((n) => [n.id, n]));
const bySource = new Map();
for (const n of graph.nodes) {
  if (!n.source_file) continue;
  if (!bySource.has(n.source_file)) bySource.set(n.source_file, []);
  bySource.get(n.source_file).push(n);
}
const lineOf = (n) => Number(String(n.source_location ?? "").replace(/^L/, "")) || 0;

// The symbol whose definition most closely precedes `line` in `file`, else the file node.
// Test bodies live in anonymous callbacks, so tests attach to their file node instead.
function enclosing(file, line) {
  const nodes = bySource.get(file) ?? [];
  const fileNode = nodes.find((n) => lineOf(n) === 1 && !n.label.endsWith("()"));
  if (/^tests\/|\.test\.tsx?$|\.spec\.tsx?$/.test(file)) return fileNode ?? null;
  let best = null;
  for (const n of nodes) {
    const l = lineOf(n);
    if (!n.label.endsWith("()") || l > line) continue;
    if (!best || l > lineOf(best)) best = n;
  }
  return best ?? fileNode ?? null;
}

const added = { nodes: [], links: [] };
const seenEdge = new Set();
function addNode(node) {
  if (byId.has(node.id)) return byId.get(node.id);
  const n = { file_type: "code", _origin: ORIGIN, ...node, norm_label: node.label.toLowerCase() };
  byId.set(n.id, n);
  added.nodes.push(n);
  return n;
}
function addEdge(source, target, relation, source_file, line) {
  const key = `${source}|${target}|${relation}`;
  if (source === target || seenEdge.has(key)) return;
  seenEdge.add(key);
  added.links.push({
    source, target, relation, confidence: "EXTRACTED", confidence_score: 1.0,
    source_file, source_location: line ? `L${line}` : undefined, weight: 1.0, _origin: ORIGIN,
    _src: source, _tgt: target,
  });
}

// Code files in the graph (graphify already applied .gitignore + .graphifyignore).
const codeFiles = [...bySource.keys()].filter((f) => /\.(ts|tsx|mts|mjs|js)$/.test(f) && existsSync(join(ROOT, f)));
const sqlFiles = [...bySource.keys()].filter((f) => f.startsWith("supabase/migrations/") && f.endsWith(".sql"));

// 1. Tables and views
const tableId = (t) => `rv_table_${t}`;
const tables = new Map(); // name -> { touches, readers, writers }
function table(name, file, line) {
  if (!tables.has(name)) {
    tables.set(name, { reads: 0, writes: 0 });
    addNode({ id: tableId(name), label: `table ${name}`, source_file: file, source_location: `L${line}`, kind: "db_table" });
  }
  return tables.get(name);
}

const DDL = /\b(create|alter)\s+(?:or\s+replace\s+)?(?:materialized\s+)?(table|view)\s+(?:if\s+(?:not\s+)?exists\s+)?(?:only\s+)?public\.([a-z_][a-z0-9_]*)/gi;
for (const file of sqlFiles.sort()) {
  const text = readFileSync(join(ROOT, file), "utf8");
  const fileNode = (bySource.get(file) ?? []).find((n) => lineOf(n) === 1 && n.label.endsWith(".sql"));
  for (const m of text.matchAll(DDL)) {
    const line = text.slice(0, m.index).split("\n").length;
    const verb = m[1].toLowerCase();
    if (verb === "alter" && !tables.has(m[3])) continue; // alter before create = another schema's table
    table(m[3], file, line);
    if (fileNode) addEdge(fileNode.id, tableId(m[3]), verb === "create" ? "creates_table" : "alters_table", file, line);
    // Graphify's own per-migration node for the table (label public.<name>) joins the canonical one.
    for (const n of bySource.get(file) ?? []) if (n.label === `public.${m[3]}`) addEdge(n.id, tableId(m[3]), "same_table", file, line);
  }
}

const KYSELY = /\.(selectFrom|insertInto|updateTable|deleteFrom|mergeInto)\(\s*["'`](?:public\.)?([a-z_][a-z0-9_]*)/g;
const RAW = /\b(from|join|update|into)\s+public\.([a-z_][a-z0-9_]*)/gi;
const WRITE_OPS = new Set(["insertInto", "updateTable", "deleteFrom", "mergeInto", "update", "into"]);
for (const file of codeFiles) {
  const text = readFileSync(join(ROOT, file), "utf8");
  for (const re of [KYSELY, RAW]) {
    for (const m of text.matchAll(re)) {
      const name = m[2];
      if (!tables.has(name)) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const from = enclosing(file, line);
      if (!from) continue;
      const write = WRITE_OPS.has(m[1]) || WRITE_OPS.has(m[1].toLowerCase());
      const t = tables.get(name);
      if (write) t.writes++;
      else t.reads++;
      addEdge(from.id, tableId(name), write ? "writes_table" : "reads_table", file, line);
    }
  }
}

// 2. PRD requirement IDs
const REQ = /\b(?:FR-)?[A-Z]{2,4}(?:-[A-Z]{2,4})?-\d{2,3}\b/g;
const reqs = new Map(); // id -> { cites }
if (existsSync(join(ROOT, PRD))) {
  const lines = readFileSync(join(ROOT, PRD), "utf8").split("\n");
  const sections = (bySource.get(PRD) ?? []).filter((n) => n.file_type === "document" && lineOf(n) > 1);
  lines.forEach((text, i) => {
    const def = text.match(/^\s*(?:[-*]\s+|\|\s*)((?:FR-)?[A-Z]{2,4}(?:-[A-Z]{2,4})?-\d{2,3})\b\s*\|?\s*(.*)$/);
    if (!def || reqs.has(def[1])) return;
    const line = i + 1;
    const summary = def[2].replace(/\s*\|.*$/, "").replace(/[`*]/g, "").trim().slice(0, 90);
    reqs.set(def[1], { cites: 0 });
    const n = addNode({
      id: `rv_req_${def[1].toLowerCase().replace(/-/g, "_")}`, label: `${def[1]} ${summary}`.trim(),
      file_type: "document", source_file: PRD, source_location: `L${line}`, kind: "requirement", requirement_id: def[1],
    });
    const section = sections.filter((s) => lineOf(s) <= line).sort((a, b) => lineOf(b) - lineOf(a))[0];
    if (section) addEdge(section.id, n.id, "contains", PRD, line);
  });
  const reqNode = (id) => `rv_req_${id.toLowerCase().replace(/-/g, "_")}`;
  for (const file of [...codeFiles, ...sqlFiles, ...[...bySource.keys()].filter((f) => f.startsWith("supabase/tests/"))]) {
    if (!existsSync(join(ROOT, file))) continue;
    const text = readFileSync(join(ROOT, file), "utf8");
    for (const m of text.matchAll(REQ)) {
      if (!reqs.has(m[0])) continue;
      const line = text.slice(0, m.index).split("\n").length;
      const from = enclosing(file, line);
      if (!from) continue;
      reqs.get(m[0]).cites++;
      addEdge(from.id, reqNode(m[0]), "cites_requirement", file, line);
    }
  }
}

// New nodes join the community of their best-connected neighbour so query output stays grouped.
const neighbours = new Map();
for (const l of added.links) {
  for (const [a, b] of [[l.source, l.target], [l.target, l.source]]) {
    if (!neighbours.has(a)) neighbours.set(a, []);
    neighbours.get(a).push(b);
  }
}
for (const n of added.nodes) {
  const counts = new Map();
  for (const id of neighbours.get(n.id) ?? []) {
    const c = byId.get(id)?.community;
    if (c !== undefined && byId.get(id)._origin !== ORIGIN) counts.set(c, (counts.get(c) ?? 0) + 1);
  }
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  if (top) {
    n.community = top[0];
    n.community_name = graph.nodes.find((x) => x.community === top[0])?.community_name;
  }
}

graph.nodes.push(...added.nodes);
graph.links.push(...added.links);
writeFileSync(GRAPH, JSON.stringify(graph));

// Append a domain section to the report (graphify regenerates the report on every
// update, so this never accumulates).
if (existsSync(REPORT)) {
  const hot = [...tables].sort((a, b) => b[1].reads + b[1].writes - (a[1].reads + a[1].writes)).slice(0, 15);
  // Budget, risk and open-question IDs are not implemented in code, so only buildable ones count.
  const uncited = [...reqs].filter(([id, r]) => r.cites === 0 && !/^(BUD|RISK|OQ|PAIN)-/.test(id)).map(([id]) => id);
  const body = [
    "", "## RouteVerde domain links (scripts/graph/link-domain.mjs)",
    `- ${tables.size} tables/views, ${added.links.filter((l) => l.relation.endsWith("_table") && !/^(creates|alters)/.test(l.relation)).length} code-to-table edges. Node ids: rv_table_<name>.`,
    `- ${reqs.size} PRD requirement IDs, ${[...reqs.values()].reduce((s, r) => s + r.cites, 0)} citations from code, SQL and pgTAP. Node ids: rv_req_<id>.`,
    "", "Most-touched tables (reads / writes):",
    ...hot.map(([name, t]) => `- \`${name}\` ${t.reads} / ${t.writes}`),
    "", `Requirements with no citation in code (${uncited.length}): ${uncited.join(", ") || "none"}`,
    "",
  ];
  appendFileSync(REPORT, body.join("\n"));
}

console.log(`[graph] domain links: ${tables.size} tables, ${reqs.size} requirements, +${added.nodes.length} nodes, +${added.links.length} edges`);
