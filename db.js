import fs from "fs";
import { DATABASE_DIR, USERS_FILE, DEUDORES_FILE } from "./config.js";

// Asegura que los archivos y carpeta existan
function ensureDatabase() {
  if (!fs.existsSync(DATABASE_DIR)) fs.mkdirSync(DATABASE_DIR);
  if (!fs.existsSync(USERS_FILE)) fs.writeFileSync(USERS_FILE, "{}");
  if (!fs.existsSync(DEUDORES_FILE)) fs.writeFileSync(DEUDORES_FILE, "[]");
}

// Lee y escribe JSON genérico
function readJSON(file) {
  ensureDatabase();
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}
function writeJSON(file, data) {
  ensureDatabase();
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

// Usuarios (por WhatsApp JID)
export function getUsers() {
  return readJSON(USERS_FILE);
}
export function getUser(jid) {
  return getUsers()[jid];
}
export function setUser(jid, userData) {
  const users = getUsers();
  users[jid] = userData;
  writeJSON(USERS_FILE, users);
}
export function removeUser(jid) {
  const users = getUsers();
  delete users[jid];
  writeJSON(USERS_FILE, users);
}

// Historial de acciones/processos de un usuario
export function logUserAction(jid, action) {
  const users = getUsers();
  if (!users[jid]) users[jid] = { historico: [] };
  if (!users[jid].historico) users[jid].historico = [];
  users[jid].historico.push({ action, date: new Date().toISOString() });
  writeJSON(USERS_FILE, users);
}

// Deudores (lista descargada de la web)
export function getDeudoresWeb() {
  return readJSON(DEUDORES_FILE);
}
export function setDeudoresWeb(list) {
  writeJSON(DEUDORES_FILE, list);
}
export function findDeudorByJid(jid) {
  const deudores = getDeudoresWeb();
  return deudores.find(x => x.jid === jid);
}
