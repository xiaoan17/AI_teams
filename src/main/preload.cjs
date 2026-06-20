const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

contextBridge.exposeInMainWorld("aiTeams", {
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  switchWorkspace: (targetRoot) => ipcRenderer.invoke("workspace:switch", targetRoot),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  listAgents: () => ipcRenderer.invoke("agents:list"),
  listAgentPresets: () => ipcRenderer.invoke("agents:presets"),
  detectAgents: () => ipcRenderer.invoke("agents:detect"),
  importAgents: (payload, options = {}) => ipcRenderer.invoke("agents:import", payload, options),
  removeAgent: (agentId) => ipcRenderer.invoke("agents:remove", agentId),
  getAgentSnapshot: (agentId, options = {}) => ipcRenderer.invoke("agents:snapshot", agentId, options),
  startAgent: (agentId) => ipcRenderer.invoke("agents:start", agentId),
  stopAgent: (agentId) => ipcRenderer.invoke("agents:stop", agentId),
  stopAllAgents: () => ipcRenderer.invoke("agents:stopAll"),
  sendInput: (agentId, data) => ipcRenderer.invoke("agents:input", agentId, data),
  resizeAgent: (agentId, cols, rows) => ipcRenderer.invoke("agents:resize", agentId, cols, rows),
  scrollAgent: (agentId, lines) => ipcRenderer.invoke("agents:scroll", agentId, lines),
  listRoles: () => ipcRenderer.invoke("roles:list"),
  hireRole: (roleId) => ipcRenderer.invoke("roles:hire", roleId),
  importRole: (sourcePath, options = {}) => ipcRenderer.invoke("roles:import", sourcePath, options),
  loadRoleDetail: (roleId) => ipcRenderer.invoke("roles:detail", roleId),
  saveRole: (roleId, payload, options = {}) => ipcRenderer.invoke("roles:save", roleId, payload, options),
  deleteRole: (roleId, options = {}) => ipcRenderer.invoke("roles:delete", roleId, options),
  pickDirectory: (options = {}) => ipcRenderer.invoke("dialog:pickDirectory", options),
  assignAgentRole: (agentId, roleId) => ipcRenderer.invoke("agents:assignRole", agentId, roleId),
  assignAgentType: (agentId, agentType) => ipcRenderer.invoke("agents:assignType", agentId, agentType),
  routeMessage: (message, targets = [], options = {}) => ipcRenderer.invoke("route:send", message, targets, options),
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  listDocuments: (folder = "") => ipcRenderer.invoke("documents:list", folder),
  toggleDocumentPinned: (relativePath) => ipcRenderer.invoke("documents:togglePinned", relativePath),
  getGitStatus: () => ipcRenderer.invoke("git:status"),
  openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
  openExternal: (url) => ipcRenderer.invoke("shell:openExternal", url),
  onAgentData: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:data", wrapped);
    listeners.add(["agent:data", wrapped]);
    return () => ipcRenderer.removeListener("agent:data", wrapped);
  },
  onAgentStatus: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("agent:status", wrapped);
    listeners.add(["agent:status", wrapped]);
    return () => ipcRenderer.removeListener("agent:status", wrapped);
  },
  onRouteVerify: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("route:verify", wrapped);
    listeners.add(["route:verify", wrapped]);
    return () => ipcRenderer.removeListener("route:verify", wrapped);
  },
  onWorkspaceChanged: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("workspace:changed", wrapped);
    listeners.add(["workspace:changed", wrapped]);
    return () => ipcRenderer.removeListener("workspace:changed", wrapped);
  },
  onDocumentsChanged: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("documents:changed", wrapped);
    listeners.add(["documents:changed", wrapped]);
    return () => ipcRenderer.removeListener("documents:changed", wrapped);
  },
  onMenuCommand: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("menu:command", wrapped);
    listeners.add(["menu:command", wrapped]);
    return () => ipcRenderer.removeListener("menu:command", wrapped);
  },
  removeAllListeners: () => {
    for (const [channel, wrapped] of listeners) {
      ipcRenderer.removeListener(channel, wrapped);
    }
    listeners.clear();
  }
});
