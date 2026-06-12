// Adaptador de almacenamiento con la misma forma que la API de Artifacts
// (window.storage), pero respaldado por localStorage para la app standalone.
// Mantiene la firma async para no tener que tocar el componente.

const PREFIJO = "bizkaia-fiscal:";

export const storage = {
  async get(key) {
    try {
      const raw = localStorage.getItem(PREFIJO + key);
      return raw === null ? null : { key, value: raw };
    } catch {
      return null;
    }
  },
  async set(key, value) {
    try {
      localStorage.setItem(PREFIJO + key, value);
      return { key, value };
    } catch {
      return null;
    }
  },
  async delete(key) {
    try {
      localStorage.removeItem(PREFIJO + key);
      return { key, deleted: true };
    } catch {
      return null;
    }
  },
  async list(prefix = "") {
    try {
      const keys = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith(PREFIJO + prefix)) keys.push(k.slice(PREFIJO.length));
      }
      return { keys, prefix };
    } catch {
      return null;
    }
  },
};
