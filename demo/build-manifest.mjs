// Lists the migrations for the demo to load. Run after adding a migration:  node demo/build-manifest.mjs
// The version changes whenever a migration does, so visitors get a fresh demo database.
import fs from "node:fs";
import crypto from "node:crypto";
const dir = new URL("../supabase/migrations/", import.meta.url);
const migrations = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
const h = crypto.createHash("sha256");
for (const f of [...migrations, "../../demo/supabase-stub.sql", "../../demo/seed.js"]) h.update(fs.readFileSync(new URL(f, dir)));
fs.writeFileSync(new URL("./migrations.json", import.meta.url), JSON.stringify({ version: h.digest("hex").slice(0, 12), migrations }, null, 2) + "\n");
console.log(`demo/migrations.json: ${migrations.length} migrations`);
