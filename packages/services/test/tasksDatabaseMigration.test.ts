// XCODE: Aiscoo 专属回归；上游 App 业务套件已退役，仅保留下游差异的断言。
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runTasksDatabaseMigrations } from "../src/session/tasksDatabase/migrations.js";

const databases: DatabaseSync[] = [];
const open = () => {
  const db = new DatabaseSync(":memory:");
  databases.push(db);
  return db;
};
let backupRoot: string;
beforeEach(async () => {
  backupRoot = await mkdtemp(join(tmpdir(), "zcode-db109-backup-"));
});
const migrate = (db: DatabaseSync) =>
  runTasksDatabaseMigrations(db, join(backupRoot, "tasks.sqlite"));
afterEach(async () => {
  for (const db of databases.splice(0)) db.close();
  await rm(backupRoot, { recursive: true, force: true });
});

describe("Aiscoo Native schema upgrade", () => {
  it("adds Native ownership without changing existing Off-Peak tasks or published ledger entries", async () => {
    const db = open();
    await migrate(db);
    db.exec(`
      DELETE FROM tasks_schema_migration WHERE id='0004_native_off_peak_owner';
      ALTER TABLE off_peak_tasks DROP COLUMN native_owner_key;
      INSERT INTO off_peak_tasks(
        off_peak_task_id,server_ticket_id,title,prompt,permission_mode,model_selection,
        workspace_key,workspace_path,status,queued_at,created_at,updated_at
      ) VALUES(
        'existing','ticket-1','Original title','Original prompt','default',
        '{"providerId":"account:zai-offpeak-idle-plan","modelId":"GLM-5.2"}',
        'ws','/ws','queued',1,2,3
      );
    `);
    const oldLedger = db
      .prepare("SELECT * FROM tasks_schema_migration ORDER BY id")
      .all();
    const original = db
      .prepare("SELECT * FROM off_peak_tasks WHERE off_peak_task_id='existing'")
      .get();
    await migrate(db);
    expect(
      db
        .prepare(
          "SELECT * FROM off_peak_tasks WHERE off_peak_task_id='existing'",
        )
        .get(),
    ).toEqual({
      ...original,
      native_owner_key: null,
    });
    expect(
      db
        .prepare(
          "SELECT * FROM tasks_schema_migration WHERE id != '0004_native_off_peak_owner' ORDER BY id",
        )
        .all(),
    ).toEqual(oldLedger);
    db.exec(
      "UPDATE off_peak_tasks SET native_owner_key='owner-digest' WHERE off_peak_task_id='existing'",
    );
    const ledger = db
      .prepare("SELECT * FROM tasks_schema_migration ORDER BY id")
      .all();
    await migrate(db);
    expect(
      db
        .prepare(
          "SELECT native_owner_key FROM off_peak_tasks WHERE off_peak_task_id='existing'",
        )
        .get(),
    ).toEqual({
      native_owner_key: "owner-digest",
    });
    expect(
      db.prepare("SELECT * FROM tasks_schema_migration ORDER BY id").all(),
    ).toEqual(ledger);
  });

  it("upgrades the published Native ledger through upstream execution scopes without changing its owner checksum", async () => {
    const db = open();
    await migrate(db);
    const nativeChecksum = createHash("sha256")
      .update(
        JSON.stringify([
          "ALTER TABLE off_peak_tasks ADD COLUMN native_owner_key TEXT",
        ]),
      )
      .digest("hex");
    expect(
      db
        .prepare(
          "SELECT checksum FROM tasks_schema_migration WHERE id='0004_native_off_peak_owner'",
        )
        .get()?.checksum,
    ).toBe(nativeChecksum);
    db.exec(`
      DELETE FROM tasks_schema_migration WHERE id IN ('0004_project_execution_scopes','0006_task_group_admissions');
      DROP TABLE task_group_admissions;
      ALTER TABLE automations DROP COLUMN project_id;
      ALTER TABLE automations DROP COLUMN host_id;
      ALTER TABLE automations DROP COLUMN additional_directories;
      ALTER TABLE off_peak_tasks DROP COLUMN project_id;
      ALTER TABLE off_peak_tasks DROP COLUMN host_id;
      ALTER TABLE off_peak_tasks DROP COLUMN additional_directories;
      INSERT INTO off_peak_tasks(
        off_peak_task_id,server_ticket_id,title,prompt,permission_mode,
        workspace_key,workspace_path,session_id,status,queued_at,created_at,updated_at,native_owner_key
      ) VALUES('native','ticket','Original','Prompt','default','ws','/ws','session','queued',1,2,3,'owner-a');
    `);
    const ledger = db
      .prepare("SELECT * FROM tasks_schema_migration ORDER BY id")
      .all();
    const original = db
      .prepare("SELECT * FROM off_peak_tasks WHERE off_peak_task_id='native'")
      .get();
    await migrate(db);
    expect(
      db
        .prepare("SELECT * FROM off_peak_tasks WHERE off_peak_task_id='native'")
        .get(),
    ).toEqual({
      ...original,
      project_id: null,
      host_id: null,
      additional_directories: null,
    });
    expect(
      db
        .prepare(
          "SELECT * FROM tasks_schema_migration WHERE id NOT IN ('0004_project_execution_scopes','0006_task_group_admissions') ORDER BY id",
        )
        .all(),
    ).toEqual(ledger);
    expect(() =>
      db.exec(`
      INSERT INTO off_peak_tasks(
        off_peak_task_id,title,prompt,permission_mode,workspace_key,workspace_path,
        session_id,status,queued_at,created_at,updated_at,native_owner_key
      ) VALUES('collision','Other','Prompt','default','ws','/ws','session','queued',1,2,3,'owner-b')
    `),
    ).toThrow(/UNIQUE/);
    expect(db.prepare("PRAGMA integrity_check").get()?.integrity_check).toBe(
      "ok",
    );
  });
});
