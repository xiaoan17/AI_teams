const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const appRoot = path.resolve(__dirname, "..");
const electronApp = path.join(appRoot, "node_modules", "electron", "dist", "Electron.app");
const outDir = path.join(appRoot, "out");
const targetApp = path.join(outDir, "AI Teams.app");
const dmgPath = path.join(outDir, `AI-Teams-${require(path.join(appRoot, "package.json")).version || "0.1.0"}-${process.arch}.dmg`);
const resourcesDir = path.join(targetApp, "Contents", "Resources");
const appPayload = path.join(resourcesDir, "app");
const icnsPath = path.join(resourcesDir, "ai-teams.icns");

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: appRoot,
    stdio: "inherit",
    ...options
  });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function rm(target) {
  fs.rmSync(target, { recursive: true, force: true });
}

function copy(source, target) {
  run("ditto", [source, target]);
}

function writeJson(file, value) {
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

function plistSet(plist, key, value) {
  run("/usr/libexec/PlistBuddy", ["-c", `Set :${key} ${value}`, plist]);
}

function plistDelete(plist, key) {
  try {
    run("/usr/libexec/PlistBuddy", ["-c", `Delete :${key}`, plist], { stdio: "ignore" });
  } catch {
    // The key is optional in Electron distributions.
  }
}

function createIcon() {
  const source = path.join(appRoot, "public", "app-icon.png");
  rm(icnsPath);
  run("sips", ["-s", "format", "icns", source, "--out", icnsPath]);
}

function packageApp() {
  if (!fs.existsSync(electronApp)) {
    throw new Error("Electron.app was not found. Run npm install first.");
  }

  run("npm", ["run", "build"]);

  rm(targetApp);
  ensureDir(outDir);
  copy(electronApp, targetApp);

  rm(path.join(resourcesDir, "default_app.asar"));
  rm(appPayload);
  ensureDir(appPayload);

  for (const item of [
    "aiteam.py",
    "dist",
    "package-lock.json",
    "package.json",
    "public",
    "src"
  ]) {
    copy(path.join(appRoot, item), path.join(appPayload, item));
  }

  copy(path.join(appRoot, "node_modules"), path.join(appPayload, "node_modules"));

  const packageJson = JSON.parse(fs.readFileSync(path.join(appRoot, "package.json"), "utf8"));
  packageJson.main = "src/main/main.cjs";
  packageJson.scripts = {};
  writeJson(path.join(appPayload, "package.json"), packageJson);

  const plist = path.join(targetApp, "Contents", "Info.plist");
  plistSet(plist, "CFBundleDisplayName", "AI Teams");
  plistSet(plist, "CFBundleName", "AI Teams");
  plistSet(plist, "CFBundleExecutable", "Electron");
  plistSet(plist, "CFBundleIdentifier", "local.ai-teams.app");
  plistSet(plist, "CFBundleShortVersionString", packageJson.version || "0.1.0");
  plistSet(plist, "CFBundleVersion", packageJson.version || "0.1.0");
  plistSet(plist, "CFBundleIconFile", "ai-teams.icns");
  plistDelete(plist, "ElectronAsarIntegrity");

  createIcon();

  run("codesign", ["--force", "--deep", "--sign", "-", targetApp]);
  console.log(`Packaged ${targetApp}`);
}

function packageDmg() {
  packageApp();
  rm(dmgPath);
  run("hdiutil", [
    "create",
    "-volname",
    "AI Teams",
    "-srcfolder",
    targetApp,
    "-ov",
    "-format",
    "UDZO",
    dmgPath
  ]);
  console.log(`Packaged ${dmgPath}`);
}

if (process.argv.includes("--dmg")) {
  packageDmg();
} else {
  packageApp();
}
