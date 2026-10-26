const { contextBridge, ipcRenderer } = require('electron');

// Solo se expone en el marco principal; las apps de terceros corren en iframes aislados sin acceso a esto
contextBridge.exposeInMainWorld('hostBridge', {
  list: d => ipcRenderer.invoke('host:list', d),
  read: f => ipcRenderer.invoke('host:read', f),
  write: (f, c) => ipcRenderer.invoke('host:write', f, c),
  remove: f => ipcRenderer.invoke('host:remove', f),
  exec: c => ipcRenderer.invoke('host:exec', c),
});
