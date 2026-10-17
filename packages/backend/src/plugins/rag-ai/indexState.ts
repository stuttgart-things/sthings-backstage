import { DatabaseService } from '@backstage/backend-plugin-api';
import { IndexState } from './indexing';

type Knex = Awaited<ReturnType<DatabaseService['getClient']>>;

const TABLE = 'rag_ai_index_state';

/**
 * Content hashes of the last successful indexing per slice, in the rag-ai
 * database next to Roadie's `embeddings` table. Deleting the rows (or the
 * table) re-indexes everything on the next run.
 */
export async function createIndexState(db: Knex): Promise<IndexState> {
  if (!(await db.schema.hasTable(TABLE))) {
    await db.schema.createTable(TABLE, table => {
      table.string('key').primary();
      table.string('hash').notNullable();
      table.timestamp('indexed_at').notNullable().defaultTo(db.fn.now());
    });
  }
  return {
    load: async () =>
      new Map(
        (await db(TABLE).select('key', 'hash')).map(row => [
          row.key as string,
          row.hash as string,
        ]),
      ),
    save: async (key, hash) => {
      await db(TABLE)
        .insert({ key, hash, indexed_at: db.fn.now() })
        .onConflict('key')
        .merge();
    },
    remove: async key => {
      await db(TABLE).where({ key }).delete();
    },
  };
}
