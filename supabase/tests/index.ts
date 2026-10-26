// Entry point for `node --experimental-strip-types --test supabase/tests/`.
// Node 22 resolves the directory to this file (see package.json "main").
// Each *.test.ts file can also be run on its own.
import "./admin.test.ts";
import "./ameria.test.ts";
import "./callbacks.test.ts";
import "./cors-config.test.ts";
import "./iphash-sanitize.test.ts";
import "./lights.test.ts";
import "./md5-idram.test.ts";
import "./moderation.test.ts";
import "./money-codes.test.ts";
import "./validation.test.ts";
