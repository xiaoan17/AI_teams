const fs = require("fs");
const path = require("path");
const { resolveRuntime } = require("./role-runtime.cjs");

function shellQuote(value) {
  const text = String(value ?? "");
  if (/^[A-Za-z0-9_./:@%+=,-]+$/.test(text)) {
    return text;
  }
  return `'${text.replace(/'/g, "'\\''")}'`;
}

function agentCwd(agent, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const cwd = agent?.cwd || workspaceRoot;
  return path.isAbsolute(cwd) ? cwd : path.resolve(workspaceRoot, cwd);
}

function warn(logger, message, context) {
  if (logger && typeof logger.warn === "function") {
    logger.warn(message, context);
  }
}

function resolveCrewDir(agent, workspaceRoot) {
  const personaDir = String(agent?.persona_dir || "").trim();
  if (!personaDir) {
    return "";
  }
  return path.isAbsolute(personaDir) ? personaDir : path.resolve(workspaceRoot, personaDir);
}

function isDirectory(filePath) {
  try {
    return fs.statSync(filePath).isDirectory();
  } catch {
    return false;
  }
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function commandFamily(agent, command) {
  const type = String(agent?.type || "").trim().toLowerCase();
  if (type) {
    return type;
  }
  return path.basename(String(command || agent?.command || "").trim()).toLowerCase();
}

function tomlString(value) {
  return JSON.stringify(String(value ?? ""));
}

function resolvePersonaFile(agent) {
  if (agent?.persona_file) {
    return String(agent.persona_file).trim() || "CLAUDE.md";
  }
  const rt = resolveRuntime(agent, "claude");
  return String(rt.instructionsFile || "CLAUDE.md").trim() || "CLAUDE.md";
}

function resolveCodexInstructionsFile(agent) {
  if (agent?.codex_instructions_file) {
    return String(agent.codex_instructions_file).trim() || "RTK.md";
  }
  const rt = resolveRuntime(agent, "codex");
  return String(rt.instructionsFile || "RTK.md").trim() || "RTK.md";
}

function appendModelParts(parts, agent, command, options = {}) {
  const model = typeof agent?.model === "string" ? agent.model.trim() : "";
  if (!model) {
    return;
  }
  const family = commandFamily(agent, command);
  if (family === "claude") {
    parts.push("--model", model);
  } else if (family === "codex") {
    parts.push("-c", `model=${model}`);
  } else {
    warn(options.logger, "agent runtime does not support model injection; skipping model", {
      agentId: agent?.id,
      runtime: family || command,
      model
    });
  }
}

function agentCommandParts(agent, options = {}) {
  const workspaceRoot = path.resolve(options.workspaceRoot || process.cwd());
  const rt = resolveRuntime(agent);
  const command = typeof options.resolveCommand === "function"
    ? options.resolveCommand(agent)
    : (agent?.command || rt.command);
  const args = Array.isArray(agent?.args) && agent.args.length
    ? agent.args
    : rt.args;
  const parts = [command, ...args].filter(Boolean);
  appendModelParts(parts, agent, command, options);
  const crewDir = resolveCrewDir(agent, workspaceRoot);
  if (!crewDir) {
    return parts;
  }

  if (!isDirectory(crewDir)) {
    warn(options.logger, "agent persona_dir missing; skipping persona injection", {
      agentId: agent?.id,
      personaDir: crewDir
    });
    return parts;
  }

  parts.push("--add-dir", crewDir);
  const family = commandFamily(agent, command);
  if (family === "codex") {
    const instructionsFile = resolveCodexInstructionsFile(agent);
    let instructionsPath = path.resolve(crewDir, instructionsFile);
    if (!isFile(instructionsPath)) {
      const fallbackPath = path.resolve(crewDir, resolvePersonaFile(agent));
      if (isFile(fallbackPath)) {
        warn(options.logger, "agent codex instructions file missing; using persona file as developer instructions fallback", {
          agentId: agent?.id,
          instructionsFile: instructionsPath,
          fallbackFile: fallbackPath
        });
        instructionsPath = fallbackPath;
      } else {
        warn(options.logger, "agent codex instructions file missing; skipping developer instructions", {
          agentId: agent?.id,
          instructionsFile: instructionsPath
        });
        return parts;
      }
    }
    try {
      const instructions = fs.readFileSync(instructionsPath, "utf8");
      parts.push("-c", `developer_instructions=${tomlString(instructions)}`);
    } catch (error) {
      warn(options.logger, "agent codex instructions file unreadable; skipping developer instructions", {
        agentId: agent?.id,
        instructionsFile: instructionsPath,
        error: error.message
      });
    }
    return parts;
  }

  const personaFile = resolvePersonaFile(agent);
  const personaPath = path.resolve(crewDir, personaFile);
  if (!isFile(personaPath)) {
    warn(options.logger, "agent persona_file missing; skipping system prompt injection", {
      agentId: agent?.id,
      personaFile: personaPath
    });
    return parts;
  }

  try {
    const personaText = fs.readFileSync(personaPath, "utf8");
    if (family === "claude") {
      parts.push("--append-system-prompt", personaText);
    } else {
      warn(options.logger, "agent runtime does not support persona prompt injection; using --add-dir only", {
        agentId: agent?.id,
        runtime: family || command
      });
    }
  } catch (error) {
    warn(options.logger, "agent persona_file unreadable; skipping system prompt injection", {
      agentId: agent?.id,
      personaFile: personaPath,
      error: error.message
    });
  }
  return parts;
}

function agentShellCommand(agent, options = {}) {
  return agentCommandParts(agent, options).map(shellQuote).join(" ");
}

module.exports = {
  agentCommandParts,
  agentCwd,
  agentShellCommand,
  shellQuote
};
