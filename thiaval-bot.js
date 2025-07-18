import makeWASocket, { useSingleFileAuthState, fetchLatestBaileysVersion } from "@whiskeysockets/baileys";
import axios from "axios";
import fs from "fs";
import {
  WEB_DEUDORES_URL,
  WEB_SYNC_INTERVAL_MIN
} from "./config.js";
import * as db from "./db.js";

// --- IA simple desde archivo ---
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
  for (const key in memory) {
    if (pregunta.includes(key.toLowerCase())) {
      return memory[key];
    }
  }
  return memory["default"] || "No tengo suficiente información para responder eso aún.";
}

// --- Sincronización automática con la web de deudores ---
async function syncDeudoresWeb() {
  try {
    const { data } = await axios.get(WEB_DEUDORES_URL);
    // data debe ser array de deudores, cada uno con {jid, nombre, deuda, vencimiento}
    if (!Array.isArray(data)) throw new Error("La respuesta de la web no es un arreglo");
    // Actualiza base local de usuarios
    const users = db.getUsers();
    const nuevos = {};
    for (const deudor of data) {
      // JID debe venir en formato correcto, si solo es el número, lo armamos
      const jid = deudor.jid.includes("@s.whatsapp.net") ? deudor.jid : `${deudor.jid}@s.whatsapp.net`;
      nuevos[jid] = {
        nombre: deudor.nombre,
        deuda: deudor.deuda,
        vencimiento: deudor.vencimiento,
        esDeudor: true,
        historico: users[jid]?.historico || []
      };
    }
    // Borra usuarios que ya no estén en la web
    Object.keys(users).forEach(jid => {
      if (!nuevos[jid]) {
        db.logUserAction(jid, "Eliminado automáticamente: ya no aparece en la web.");
      }
    });
    db.setAllUsers(nuevos);
    console.log(`[${new Date().toISOString()}] Sincronización con web de deudores: ${Object.keys(nuevos).length} usuarios.`);
  } catch (err) {
    console.error("Error al sincronizar deudores web:", err.message);
  }
}

// --- Recordatorio cada 2 días mientras tenga deuda ---
function needsReminder(user) {
  if (!user.esDeudor || !user.deuda || user.deuda <= 0) return false;
  // Checar si ya se envió un recordatorio en los últimos 2 días
  let ultimos = user.historico ? user.historico.filter(h =>
    h.action.includes("Enviado recordatorio automático")
  ) : [];
  if (ultimos.length > 0) {
    let lastDate = new Date(ultimos[ultimos.length - 1].date);
    let diff = (Date.now() - lastDate.getTime()) / (1000 * 60 * 60 * 24);
    if (diff < 2) return false;
  }
  return true;
}

async function main() {
  const { state, saveState } = useSingleFileAuthState("./auth_info.json");
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({ version, auth: state });

  // Sincroniza con la web cada N minutos
  setInterval(syncDeudoresWeb, WEB_SYNC_INTERVAL_MIN * 60 * 1000);
  await syncDeudoresWeb();

  // ENVÍA recordatorios a todos los usuarios cada 2 días si deben
  setInterval(async () => {
    const users = db.getUsers();
    for (const jid in users) {
      if (needsReminder(users[jid])) {
        await sock.sendMessage(jid, {
          text: `Hola ${users[jid].nombre} 👋

Te recordamos que tienes una deuda pendiente de $${users[jid].deuda} con vencimiento el ${users[jid].vencimiento}.

Por favor, contáctanos para regularizar tu situación o acude a alguna de nuestras sucursales.

Gracias.`
        });
        db.logUserAction(jid, "Enviado recordatorio automático de deuda (cada 2 días).");
      }
    }
  }, 60 * 60 * 1000); // Chequea cada hora

  // RESPONDE automáticamente usando IA
  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;
    const jid = msg.key.remoteJid;
    const text = msg.message.conversation || msg.message.extendedTextMessage?.text || "";

    const user = db.getUser(jid) || {};
    // IA: responde usando la base de conocimiento
    const respuesta = iaAnswer(text);
    await sock.sendMessage(jid, { text: respuesta });
    db.logUserAction(jid, `Respondió con IA: "${respuesta}" a la pregunta: "${text}"`);
  });

  sock.ev.on("creds.update", saveState);
}

main();
