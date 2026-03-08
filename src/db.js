import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dataPath = path.resolve(__dirname, "data", "db.json");

const initialData = {
  users: [],
  vegetables: [],
  orders: [],
  passwordResets: []
};

export async function readDb() {
  try {
    const raw = await fs.readFile(dataPath, "utf8");
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      vegetables: Array.isArray(parsed.vegetables) ? parsed.vegetables : [],
      orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      passwordResets: Array.isArray(parsed.passwordResets) ? parsed.passwordResets : []
    };
  } catch (error) {
    if (error.code === "ENOENT") {
      await writeDb(initialData);
      return initialData;
    }
    throw error;
  }
}

export async function writeDb(db) {
  await fs.mkdir(path.dirname(dataPath), { recursive: true });
  await fs.writeFile(dataPath, JSON.stringify(db, null, 2), "utf8");
}
