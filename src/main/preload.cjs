const { contextBridge, ipcRenderer } = require("electron");

const listeners = new Set();

contextBridge.exposeInMainWorld("aiTeams", {
  getWorkspace: () => ipcRenderer.invoke("workspace:get"),
  switchWorkspace: (targetRoot) => ipcRenderer.invoke("workspace:switch", targetRoot),
  chooseWorkspace: () => ipcRenderer.invoke("workspace:choose"),
  listAgents: () => ipcRenderer.invoke("agents:list"),
  getAgentSnapshot: (agentId) => ipcRenderer.invoke("agents:snapshot", agentId),
  startAgent: (agentId) => ipcRenderer.invoke("agents:start", agentId),
  stopAgent: (agentId) => ipcRenderer.invoke("agents:stop", agentId),
  sendInput: (agentId, data) => ipcRenderer.invoke("agents:input", agentId, data),
  resizeAgent: (agentId, cols, rows) => ipcRenderer.invoke("agents:resize", agentId, cols, rows),
  routeMessage: (message, targets = [], options = {}) => ipcRenderer.invoke("route:send", message, targets, options),
  listTasks: () => ipcRenderer.invoke("tasks:list"),
  listDocuments: (folder = "") => ipcRenderer.invoke("documents:list", folder),
  toggleDocumentPinned: (relativePath) => ipcRenderer.invoke("documents:togglePinned", relativePath),
  getGitStatus: () => ipcRenderer.invoke("git:status"),
  openPath: (targetPath) => ipcRenderer.invoke("shell:openPath", targetPath),
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
  onWorkspaceChanged: (callback) => {
    const wrapped = (_event, payload) => callback(payload);
    ipcRenderer.on("workspace:changed", wrapped);
    listeners.add(["workspace:changed", wrapped]);
    return () => ipcRenderer.removeListener("workspace:changed", wrapped);
  },
  removeAllListeners: () => {
    for (const [channel, wrapped] of listeners) {
      ipcRenderer.removeListener(channel, wrapped);
    }
    listeners.clear();
  }
});
