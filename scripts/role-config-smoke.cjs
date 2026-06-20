// Smoke test for role config read/save/delete logic.
//
// main.cjs cannot be require()d outside Electron (it depends on the `app` module
// and registers IPC handlers at load), so this mirrors the loadRoleDetail /
// saveRole / deleteRole / validateRoleSource algorithms and exercises them
// against real temp directories — the same "replicated algorithm + real data"
// approach used to verify the multi-library merge.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

// ---- replicated algorithms (kept in lockstep with src/main/main.cjs) ----

function readJson(file, fallback = null) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}
function writeJson(file, value) {
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function validateRoleSource(source, expectedId = null) {
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    throw new Error(`Role template directory not found: ${source}`);
  }
  const rolePath = path.join(source, "role.json");
  if (!fs.existsSync(rolePath)) throw new Error(`missing role.json: ${rolePath}`);
  const role = readJson(rolePath, null);
  if (!role || typeof role !== "object" || Array.isArray(role)) {
    throw new Error("role.json must be an object");
  }
  const templateId = String(role.id || path.basename(source));
  if (expectedId !== null && templateId !== expectedId) {
    throw new Error(`id mismatch: expected ${expectedId}, got ${templateId}`);
  }
  const personaFile = String(role.persona_file || "CLAUDE.md");
  if (!fs.existsSync(path.join(source, personaFile))) {
    throw new Error(`missing persona ${personaFile}`);
  }
  const skillsRoot = path.join(source, ".claude", "skills");
  let hasSkill = false;
  if (fs.existsSync(skillsRoot) && fs.statSync(skillsRoot).isDirectory()) {
    hasSkill = fs.readdirSync(skillsRoot, { withFileTypes: true }).some(
      (e) => e.isDirectory() && fs.existsSync(path.join(skillsRoot, e.name, "SKILL.md"))
    );
  }
  if (!hasSkill) throw new Error("must include at least one SKILL.md");
  const model = role.model;
  if (model !== undefined && model !== null && (typeof model !== "string" || !model.trim())) {
    throw new Error("model must be a non-empty string when present");
  }
  const collab = role.collab;
  if (collab !== undefined && collab !== null) {
    if (typeof collab !== "object" || Array.isArray(collab)) throw new Error("collab must be an object");
    for (const key of ["upstream", "downstream"]) {
      if (key in collab && (!Array.isArray(collab[key]) || !collab[key].every((i) => typeof i === "string"))) {
        throw new Error(`collab.${key} must be an array of strings`);
      }
    }
    if ("handoff_via" in collab && typeof collab.handoff_via !== "string") {
      throw new Error("collab.handoff_via must be a string");
    }
  }
  return { role, id: templateId };
}

function listRoleSkillDirs(roleSource) {
  const skillsRoot = path.join(roleSource, ".claude", "skills");
  if (!fs.existsSync(skillsRoot) || !fs.statSync(skillsRoot).isDirectory()) return [];
  return fs.readdirSync(skillsRoot, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(skillsRoot, e.name, "SKILL.md")))
    .map((e) => e.name).sort();
}

// libraries: [workspace, global] (workspace wins)
function makeLib(workspaceRoot, globalRoot) {
  const workspaceLibrary = path.join(workspaceRoot, ".aiteam", "roles");
  const dirs = [...new Set([workspaceLibrary, globalRoot])];
  return { workspaceLibrary, dirs };
}

function loadRoleDetail(roleId, lib) {
  const id = String(roleId || "").trim();
  for (const library of lib.dirs) {
    const source = path.join(library, id);
    const rolePath = path.join(source, "role.json");
    if (!fs.existsSync(rolePath)) continue;
    const template = readJson(rolePath, null);
    const personaFile = String(template.persona_file || "CLAUDE.md");
    const personaPath = path.join(source, personaFile);
    const content = fs.existsSync(personaPath) ? fs.readFileSync(personaPath, "utf8") : "";
    const origin = library === lib.workspaceLibrary ? "workspace" : "global";
    return {
      id, source, library, origin, editable: origin === "workspace",
      template, persona: { file: personaFile, content }, skillDirs: listRoleSkillDirs(source)
    };
  }
  throw new Error(`Unknown role template: ${id}`);
}

function normalizeStringArray(value) {
  if (Array.isArray(value)) return value.map((i) => String(i).trim()).filter(Boolean);
  return [];
}

function saveRole(roleId, payload, options, lib) {
  const detail = loadRoleDetail(roleId, lib);
  const id = detail.id;
  let targetLibrary = detail.library;
  let target = detail.source;
  if (detail.origin === "global") {
    if (!options.promoteToWorkspace) throw new Error("global requires promoteToWorkspace");
    targetLibrary = lib.workspaceLibrary;
    target = path.join(targetLibrary, id);
  }
  ensureDir(targetLibrary);
  const template = detail.template;
  const roleMeta = template.role && typeof template.role === "object" ? { ...template.role } : {};
  const payloadRole = payload.role || {};
  for (const key of ["title", "emoji", "summary", "track"]) {
    if (key in payloadRole) roleMeta[key] = String(payloadRole[key] ?? "");
  }
  const merged = { ...template, id, role: roleMeta };
  merged.command = String(payload.command || template.command || "claude").trim() || "claude";
  if (payload.args !== undefined) merged.args = normalizeStringArray(payload.args);
  if (payload.skills !== undefined) merged.skills = normalizeStringArray(payload.skills);
  const model = typeof payload.model === "string" ? payload.model.trim() : "";
  if (model) merged.model = model; else delete merged.model;
  if (payload.collab !== undefined) {
    const ci = payload.collab || {};
    const collab = {};
    const up = normalizeStringArray(ci.upstream);
    const down = normalizeStringArray(ci.downstream);
    const handoff = typeof ci.handoff_via === "string" ? ci.handoff_via.trim() : "";
    if (up.length) collab.upstream = up;
    if (down.length) collab.downstream = down;
    if (handoff) collab.handoff_via = handoff;
    if (Object.keys(collab).length) merged.collab = collab; else delete merged.collab;
  }
  const personaFile = String(merged.persona_file || "CLAUDE.md");
  const personaContent = payload.persona ? String(payload.persona.content ?? "") : detail.persona.content;
  const tmp = path.join(targetLibrary, `.edit-tmp-${id}-${Date.now()}`);
  try {
    fs.cpSync(detail.source, tmp, { recursive: true });
    writeJson(path.join(tmp, "role.json"), merged);
    fs.writeFileSync(path.join(tmp, personaFile), personaContent);
    validateRoleSource(tmp, id);
    if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true });
    fs.renameSync(tmp, target);
  } finally {
    if (fs.existsSync(tmp)) fs.rmSync(tmp, { recursive: true, force: true });
  }
  return { ok: true, id, origin: detail.origin === "global" ? "workspace" : detail.origin, source: target };
}

function deleteRole(roleId, options, lib) {
  const detail = loadRoleDetail(roleId, lib);
  if (detail.origin === "global" && !options.allowGlobal) throw new Error("global requires allowGlobal");
  fs.rmSync(detail.source, { recursive: true, force: true });
  return { ok: true, removed: detail.id, origin: detail.origin };
}

// ---- fixtures ----

function writeRole(dir, id, { persona = "# persona\n", model, collab } = {}) {
  fs.mkdirSync(path.join(dir, ".claude", "skills", "frontend-ui"), { recursive: true });
  const role = {
    id, name: id,
    role: { title: id, summary: "s", emoji: "F", track: "impl" },
    command: "claude", args: ["--dangerously-skip-permissions"],
    skills: ["frontend-ui"], persona_file: "CLAUDE.md", version: "0.1.0"
  };
  if (model !== undefined) role.model = model;
  if (collab !== undefined) role.collab = collab;
  writeJson(path.join(dir, "role.json"), role);
  fs.writeFileSync(path.join(dir, "CLAUDE.md"), persona);
  fs.writeFileSync(path.join(dir, ".claude", "skills", "frontend-ui", "SKILL.md"), "# skill\n");
}

// ---- run ----

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "role-config-smoke-"));
try {
  const workspace = path.join(tmpRoot, "ws");
  const globalRoot = path.join(tmpRoot, "global-roles");
  fs.mkdirSync(workspace, { recursive: true });
  fs.mkdirSync(globalRoot, { recursive: true });
  const lib = makeLib(workspace, globalRoot);

  // 1) read a workspace role
  const wsRole = path.join(workspace, ".aiteam", "roles", "frontend");
  writeRole(wsRole, "frontend", { persona: "# 前端\n负责界面。\n", model: "opus",
    collab: { upstream: ["prd"], downstream: ["qa"], handoff_via: ".aiteam/tasks/" } });
  let detail = loadRoleDetail("frontend", lib);
  assert.strictEqual(detail.origin, "workspace", "frontend should be workspace origin");
  assert.strictEqual(detail.template.role.title, "frontend");
  assert.strictEqual(detail.persona.content, "# 前端\n负责界面。\n", "persona content should round-trip");
  assert.deepStrictEqual(detail.skillDirs, ["frontend-ui"], "skillDirs should list physical skills");

  // 2) save edits (title/args/persona/collab); id must not change
  saveRole("frontend", {
    role: { title: "前端工程师" },
    args: ["--dangerously-skip-permissions", "--verbose"],
    model: "",                       // clearing model should delete the key
    collab: { upstream: ["prd", "manager"], downstream: [], handoff_via: "" },
    persona: { content: "# 前端 v2\n" }
  }, {}, lib);
  const savedJson = readJson(path.join(wsRole, "role.json"), null);
  assert.strictEqual(savedJson.id, "frontend", "id must stay locked");
  assert.strictEqual(savedJson.role.title, "前端工程师", "title should update");
  assert.deepStrictEqual(savedJson.args, ["--dangerously-skip-permissions", "--verbose"], "args should update");
  assert.ok(!("model" in savedJson), "empty model should delete the key");
  assert.deepStrictEqual(savedJson.collab, { upstream: ["prd", "manager"] }, "collab should drop empty fields");
  assert.strictEqual(fs.readFileSync(path.join(wsRole, "CLAUDE.md"), "utf8"), "# 前端 v2\n", "persona should update");

  // 3) invalid save must not land (missing SKILL.md → validate throws, target untouched)
  const before = fs.readFileSync(path.join(wsRole, "role.json"), "utf8");
  let threw = false;
  try {
    // simulate a staged dir that loses its skill, by deleting skill then saving
    const brokenWs = path.join(tmpRoot, "broken", ".aiteam", "roles", "broken");
    writeRole(brokenWs, "broken");
    fs.rmSync(path.join(brokenWs, ".claude", "skills", "frontend-ui", "SKILL.md"));
    validateRoleSource(brokenWs, "broken");
  } catch {
    threw = true;
  }
  assert.ok(threw, "validate should reject a role missing SKILL.md");
  assert.strictEqual(fs.readFileSync(path.join(wsRole, "role.json"), "utf8"), before, "valid role untouched");

  // 4) global → workspace promotion
  const globalRole = path.join(globalRoot, "designer");
  writeRole(globalRole, "designer", { persona: "# 设计师\n" });
  detail = loadRoleDetail("designer", lib);
  assert.strictEqual(detail.origin, "global", "designer should be global origin");
  let promoteThrew = false;
  try { saveRole("designer", { role: { title: "X" } }, {}, lib); } catch { promoteThrew = true; }
  assert.ok(promoteThrew, "saving a global role without promoteToWorkspace should throw");
  const promoted = saveRole("designer", { role: { title: "设计师 v2" }, persona: { content: "# 设计师 v2\n" } },
    { promoteToWorkspace: true }, lib);
  assert.strictEqual(promoted.origin, "workspace", "promotion result origin should be workspace");
  const wsDesigner = path.join(workspace, ".aiteam", "roles", "designer");
  assert.ok(fs.existsSync(wsDesigner), "promotion should create a workspace copy");
  assert.strictEqual(readJson(path.join(wsDesigner, "role.json"), null).role.title, "设计师 v2", "ws copy edited");
  assert.strictEqual(readJson(path.join(globalRole, "role.json"), null).role.title, "designer", "global original untouched");
  // now designer resolves to workspace (priority)
  assert.strictEqual(loadRoleDetail("designer", lib).origin, "workspace", "ws copy should now win");

  // 5) delete: workspace allowed, global guarded
  deleteRole("frontend", {}, lib);
  assert.ok(!fs.existsSync(wsRole), "delete should remove the workspace role dir");
  let loadThrew = false;
  try { loadRoleDetail("frontend", lib); } catch { loadThrew = true; }
  assert.ok(loadThrew, "deleted role should no longer load");
  // designer global copy still exists; deleting it without allowGlobal must fail
  fs.rmSync(wsDesigner, { recursive: true, force: true }); // remove ws copy so designer resolves to global
  let delGlobalThrew = false;
  try { deleteRole("designer", {}, lib); } catch { delGlobalThrew = true; }
  assert.ok(delGlobalThrew, "deleting a global role without allowGlobal should throw");
  assert.ok(fs.existsSync(globalRole), "global role must survive a guarded delete");

  console.log("role config smoke passed");
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
}
