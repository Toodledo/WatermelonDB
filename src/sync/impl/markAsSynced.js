// @flow

import areRecordsEqual from '../../utils/fp/areRecordsEqual'
import { logError } from '../../utils/common'
import type { Database, Model, TableName } from '../..'

import { prepareMarkAsSynced, prepareCreateMapping } from './helpers'
import type { SyncLocalChanges, SyncRejectedIds, SyncPublishedRecords } from '../index'
import { createDebuggerStatement } from 'typescript'
import { consoleTestResultHandler } from 'tslint/lib/test'
import { IdMappingModel } from '../../Database/IdMapping'

const recordsToMarkAsSynced = (
  { changes, affectedRecords }: SyncLocalChanges,
  allRejectedIds: SyncRejectedIds,
  published?: ?SyncPublishedRecords,
): Model[] => {
  const syncedRecords = []

  Object.keys(changes).forEach((table) => {
    const { created, updated } = changes[(table: any)]
    const raws = created.concat(updated)
    const rejectedIds = new Set(allRejectedIds[(table: any)])

    const publishedIds = published[(table: any)]
    raws.forEach((raw, i) => {
      const { id } = raw
      const record = affectedRecords.find((model) => model.id === id && model.table === table)
      if (!record) {
        logError(
          `[Sync] Looking for record ${table}#${id} to mark it as synced, but I can't find it. Will ignore it (it should get synced next time). This is probably a Watermelon bug — please file an issue!`,
        )
        return
      }
      let publishedToServer = true
      if (publishedIds) {
        publishedToServer = publishedIds[i] && publishedIds[i] !== '0' ? true : false
      }
      if (areRecordsEqual(record._raw, raw) && !rejectedIds.has(id) && publishedToServer) {
        syncedRecords.push(record)
      }
    })
  })
  return syncedRecords
}

const recordsToSaveMapping = (
  { changes, affectedRecords }: SyncLocalChanges,
  published?: ?SyncPublishedRecords,
): any[] => {
  const mappings = []
  if (published) {
    Object.keys(changes).forEach((table) => {
      const { created } = changes[(table: any)]
      const publishedIds = published[(table: any)]

      if (publishedIds?.length > 0) {
        created.forEach((raw, index) => {
          const mapping = { localId: raw.id, remoteId: publishedIds[index], table: table }
          mappings.push(mapping)
        })
      }
    })
  }
  return mappings
}

const destroyDeletedRecords = (
  db: Database,
  { changes }: SyncLocalChanges,
  allRejectedIds: SyncRejectedIds,
): Promise<any>[] => {
  return Object.keys(changes).map((_tableName) => {
    const tableName: TableName<any> = (_tableName: any)
    const rejectedIds = new Set(allRejectedIds[tableName])
    const deleted = changes[tableName].deleted.filter((id) => !rejectedIds.has(id))
    return deleted.length ? db.adapter.destroyDeletedRecords(tableName, deleted) : Promise.resolve()
  })
}

export default function markLocalChangesAsSynced(
  db: Database,
  syncedLocalChanges: SyncLocalChanges,
  rejectedIds?: ?SyncRejectedIds,
  published?: ?SyncPublishedRecords,
): Promise<void> {
  return db.write(async () => {
    // update and destroy records concurrently
    await Promise.all([
      db.batch(
        ...recordsToMarkAsSynced(syncedLocalChanges, rejectedIds || {}, published || {}).map(
          prepareMarkAsSynced,
        ),
        ...recordsToSaveMapping(syncedLocalChanges, published).map((mapping) =>
          prepareCreateMapping(db, mapping.table, mapping.remoteId, mapping.localId),
        ),
      ),
      ...destroyDeletedRecords(db, syncedLocalChanges, rejectedIds || {}),
    ])
  }, 'sync-markLocalChangesAsSynced')
}
