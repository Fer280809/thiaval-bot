import makeWASocket, { useSingleFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import axios from "axios";
import fs from "fs";
import {
  WEB_DEUDORES_URL,
  WEB_SYNC_INTERVAL_MIN
} from "./config.js";
import * as db from "./db.js";

// --- Cargar IA básica desde archivo ---
function loadIAMemory() {
  try {
    return JSON.parse(fs.readFileSync("./ia-memory.json", "utf-8"));
  } catch (e) {
    return {};
  }
}
function iaAnswer(text) {
  const memory = loadIAMemory();
  const pregunta = text.trim().toLowerCase();
  // Busca respuesta exacta o por coincidencia parcial
  for (const key in memory) {
    if (pregunta.includes(key.toLowerCase())) {
      return memory[key];
    }
  }
  return memory["default"] || "No tengo suficiente información para responder eso aún.";
}

// Resto igual que antes...
async function syncDeudoresWeb() { /* ... igual ... */ }
function needsReminder(user) { /* ... igual ... */ }

async function main() {
  const { state, saveState } = useSingleFileAuthState("./auth_info.json");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state });

  setInterval(syncDeudoresWeb, WEB_SYNC_INTERVAL_MIN * 60 * 1000);
  await syncDeudoresWeb();

  setInterval(async () => {
    const users = db.getUsers();
    for (const jid in users) {
      if (needsReminder(users[jid])) {
        await sock.sendMessage(jid, {
          text: `Hola ${users[jid].nombre} 👋\n\nTe recordamos que tienes una deuda pendiente de $${users[jid].deuda} con vencimiento el ${users[jid].vencimiento}.\n\nPor favor, contáctanos para regularizar tu situación o acude a alguna de nuestras sucursales.\n\nGracias.`
        });
        db.logUserAction(jid, "Enviado recordatorio automático de deuda próxima a vencer.");
      }
    }
  }, 10 * 60 * 1000);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    const user = db.getUser(jid) || {};
    if (needsReminder(user)) {
      await sock.sendMessage(jid, {
        text: `Hola ${user.nombre} 👋\n\nTe recordamos que tienes una deuda pendiente de $${user.deuda} con vencimiento el ${user.vencimiento}.\n\nPor favor, contáctanos para regularizar tu situación o acude a alguna de nuestras sucursales.\n\nGracias.`
      });
      db.logUserAction(jid, "Enviado recordatorio por mensaje recibido.");
    } else {
      // IA: responde usando la base de conocimiento
      const respuesta = iaAnswer(text);
      await sock.sendMessage(jid, { text: respuesta });
      db.logUserAction(jid, `Respondió con IA: "${respuesta}" a la pregunta: "${text}"`);
    }
  });

  sock.ev.on("creds.update", saveState);
}

main();
