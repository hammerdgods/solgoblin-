import { promises as fs } from "node:fs";
import path from "node:path";
import { log } from "../log";
import { emptyTables, MemoryStore, type MemoryTables } from "./memoryStore";

/**
 * Local JSON-file store for development / single-instance deployments.
 * Writes are serialized and atomic (write temp file, then rename).
 * Not suitable for serverless platforms with ephemeral or read-only filesystems.
 */
export class FileStore extends MemoryStore {
  override readonly kind = "file" as const;
  override readonly durable = true;

  private constructor(tables: MemoryTables, persist: (t: MemoryTables) => Promise<void>) {
    super(tables, persist);
  }

  static async open(dir: string): Promise<FileStore> {
    const file = path.resolve(dir, "yieldgoblin-db.json");
    await fs.mkdir(path.dirname(file), { recursive: true });
    let tables = emptyTables();
    try {
      const raw = JSON.parse(await fs.readFile(file, "utf8")) as Partial<MemoryTables>;
      tables = { ...emptyTables(), ...raw };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") log.warn("store", "could not read data file; starting empty", { file, message: (e as Error).message });
    }
    let chain: Promise<void> = Promise.resolve();
    const persist = (t: MemoryTables) => {
      chain = chain.then(async () => {
        const tmp = `${file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(t), "utf8");
        await fs.rename(tmp, file);
      });
      return chain;
    };
    return new FileStore(tables, persist);
  }
}
