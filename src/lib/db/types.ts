import type { NeonHttpDatabase } from 'drizzle-orm/neon-http'
import type * as schema from './schema.js'

// The one Db type every service takes. Declaring it locally as
// NeonHttpDatabase<Record<string, never>> compiles in isolation and then
// rejects the real client at the call site, because drizzle carries the
// schema in the generic — so the alias has to be built from the schema
// module, not from a placeholder.
export type Db = NeonHttpDatabase<typeof schema>
