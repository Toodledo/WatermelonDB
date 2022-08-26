// @flow

import { mapObj, filterObj, pipe, toPairs } from '../../utils/fp'
import splitEvery from '../../utils/fp/splitEvery'
import allPromisesObj from '../../utils/fp/allPromisesObj'
import { logError, invariant, logger } from '../../utils/common'
import type { Database, RecordId, Collection, Model, TableName, DirtyRaw } from '../..'
import * as Q from '../../QueryDescription'
import { columnName } from '../../Schema'
import { type RelatedRecords } from './idMapper'

import type {
  SyncTableChangeSet,
  SyncDatabaseChangeSet,
  SyncLog,
  SyncConflictResolver,
} from '../index'
import { prepareCreateFromRaw, prepareUpdateFromRaw } from './helpers'
import { getAllRelatedLocalIdsForChanges, convertRelatedRemoteToLocalIds } from './idMapper'

const idsForChanges = ({ created, updated, deleted }: SyncTableChangeSet): RecordId[] => {
  const ids = []
  created.forEach((record) => {
    ids.push(record.id)
  })
  updated.forEach((record) => {
    ids.push(record.id)
  })
  return ids.concat(deleted)
}

const fetchRecordsForChanges = <T: Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
  ids: string[],
): Promise<T[]> => {
  if (ids.length) {
    return collection.query(Q.where(columnName('id'), Q.oneOf(ids))).fetch()
  }

  return Promise.resolve([])
}

const findRecord = <T: Model>(id: RecordId, list: T[]): T | null => {
  // perf-critical
  for (let i = 0, len = list.length; i < len; i += 1) {
    if (list[i]._raw.id === id) {
      return list[i]
    }
  }
  return null
}

type RecordsToApplyRemoteChangesTo<T: Model> = {
  ...SyncTableChangeSet,
  records: T[],
  recordsToDestroy: T[],
  locallyDeletedIds: RecordId[],
  deletedRecordsToDestroy: RecordId[],
  remoteToLocalIdMap: Object,
  relatedRecords?: RelatedRecords,
}
async function recordsToApplyRemoteChangesTo<T: Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
): Promise<RecordsToApplyRemoteChangesTo<T>> {
  const { database, table, modelClass } = collection
  let { deleted: deletedIds } = changes

  // these are remoteIDs
  let ids = idsForChanges(changes)

  // if we are using IdMapping, then convert to local ids
  let remoteToLocalIdMap = {}
  let relatedRecords = null
  if (database.useIdMapping) {
    remoteToLocalIdMap = await database.idMappingTable.getMappingsForRemoteIds(ids, table)
    // get local IDs to search for
    ids = Object.values(remoteToLocalIdMap)

    deletedIds = await database.idMappingTable.getLocalIds(deletedIds, table)
    relatedRecords = await getAllRelatedLocalIdsForChanges(collection, changes)
  }
  const [records, locallyDeletedIds] = await Promise.all([
    fetchRecordsForChanges(collection, changes, ids),
    database.adapter.getDeletedRecords(table),
  ])

  return {
    ...changes,
    records,
    locallyDeletedIds,
    recordsToDestroy: records.filter((record) => deletedIds.includes(record.id)),
    deletedRecordsToDestroy: locallyDeletedIds.filter((id) => deletedIds.includes(id)),
    remoteToLocalIdMap,
    relatedRecords,
  }
}

function validateRemoteRaw(raw: DirtyRaw): void {
  // TODO: I think other code is actually resilient enough to handle illegal _status and _changed
  // would be best to change that part to a warning - but tests are needed
  invariant(
    raw && typeof raw === 'object' && 'id' in raw && !('_status' in raw || '_changed' in raw),
    `[Sync] Invalid raw record supplied to Sync. Records must be objects, must have an 'id' field, and must NOT have a '_status' or '_changed' fields`,
  )
}

function prepareApplyRemoteChangesToCollection<T: Model>(
  collection: Collection<T>,
  recordsToApply: RecordsToApplyRemoteChangesTo<T>,
  sendCreatedAsUpdated: boolean,
  log?: SyncLog,
  conflictResolver?: SyncConflictResolver,
  preparedIdMappings?: Object,
): Model[] {
  const { database, table } = collection
  const {
    created,
    updated,
    recordsToDestroy: deleted,
    records,
    locallyDeletedIds,
    remoteToLocalIdMap,
    relatedRecords,
  } = recordsToApply
  const useIdMapping = database.useIdMapping

  // if `sendCreatedAsUpdated`, server should send all non-deleted records as `updated`
  // log error if it doesn't — but disable standard created vs updated errors
  if (sendCreatedAsUpdated && created.length) {
    logError(
      `[Sync] 'sendCreatedAsUpdated' option is enabled, and yet server sends some records as 'created'`,
    )
  }

  const related = relatedRecords
  const recordsToBatch: Model[] = [] // mutating - perf critical

  // Insert and update records
  created.forEach((raw) => {
    validateRemoteRaw(raw)
    let id = raw.id
    if (useIdMapping) {
      id = remoteToLocalIdMap[id] // if we are using id mapping, then first get the localid
      convertRelatedRemoteToLocalIds(raw, relatedRecords, preparedIdMappings)
    }
    const currentRecord = findRecord(id, records)
    if (currentRecord) {
      logError(
        `[Sync] Server wants client to create record ${table}#${raw.id}, but it already exists locally. This may suggest last sync partially executed, and then failed; or it could be a serious bug. Will update existing record instead.`,
      )
      recordsToBatch.push(prepareUpdateFromRaw(currentRecord, raw, log, conflictResolver))
    } else if (locallyDeletedIds.includes(raw.id)) {
      logError(
        `[Sync] Server wants client to create record ${table}#${raw.id}, but it already exists locally and is marked as deleted. This may suggest last sync partially executed, and then failed; or it could be a serious bug. Will delete local record and recreate it instead.`,
      )
      // Note: we're not awaiting the async operation (but it will always complete before the batch)
      database.adapter.destroyDeletedRecords(table, [raw.id])
      recordsToBatch.push(...prepareCreateFromRaw(collection, raw))
    } else {
      recordsToBatch.push(...prepareCreateFromRaw(collection, raw))
    }
    if (useIdMapping) {
      const t = recordsToBatch
        .filter((m) => m.table === 'id_mapping')
        .reduce((map, obj) => ((map[obj.remoteId] = obj.localId), map), {})

      preparedIdMappings[table] = t
    }
  })

  updated.forEach((raw) => {
    validateRemoteRaw(raw)
    let id = raw.id
    if (useIdMapping) {
      id = remoteToLocalIdMap[id] // if we are using id mapping, then first get the localid
      convertRelatedRemoteToLocalIds(raw, relatedRecords, preparedIdMappings)
    }

    const currentRecord = findRecord(id, records)

    if (currentRecord) {
      recordsToBatch.push(prepareUpdateFromRaw(currentRecord, raw, log, conflictResolver))
    } else if (locallyDeletedIds.includes(raw.id)) {
      // Nothing to do, record was locally deleted, deletion will be pushed later
    } else {
      // Record doesn't exist (but should) — just create it
      !sendCreatedAsUpdated &&
        logError(
          `[Sync] Server wants client to update record ${table}#${raw.id}, but it doesn't exist locally. This could be a serious bug. Will create record instead. If this was intentional, please check the flag sendCreatedAsUpdated in https://nozbe.github.io/WatermelonDB/Advanced/Sync.html#additional-synchronize-flags`,
        )

      recordsToBatch.push(...prepareCreateFromRaw(collection, raw))
    }
    if (useIdMapping) {
      const t = recordsToBatch
        .filter((m) => m.table === 'id_mapping')
        .reduce((map, obj) => ((map[obj.remoteId] = obj.localId), map), {})

      preparedIdMappings[table] = t
    }
  })

  deleted.forEach((record) => {
    // $FlowFixMe
    recordsToBatch.push(record.prepareDestroyPermanently(true))
  })

  return recordsToBatch
}

type AllRecordsToApply = { [TableName<any>]: RecordsToApplyRemoteChangesTo<Model> }

const getAllRecordsToApply = (
  db: Database,
  remoteChanges: SyncDatabaseChangeSet,
): AllRecordsToApply =>
  allPromisesObj(
    pipe(
      filterObj((_changes, tableName: TableName<any>) => {
        const collection = db.get((tableName: any))

        if (!collection) {
          logger.warn(
            `You are trying to sync a collection named ${tableName}, but it does not exist. Will skip it (for forward-compatibility). If this is unexpected, perhaps you forgot to add it to your Database constructor's modelClasses property?`,
          )
        }

        return !!collection
      }),
      mapObj((changes, tableName: TableName<any>) => {
        return recordsToApplyRemoteChangesTo(db.get((tableName: any)), changes)
      }),
    )(remoteChanges),
  )

const destroyAllDeletedRecords = (db: Database, recordsToApply: AllRecordsToApply): Promise<*> => {
  const promises = toPairs(recordsToApply).map(([tableName, { deletedRecordsToDestroy }]) => {
    return deletedRecordsToDestroy.length
      ? db.adapter.destroyDeletedRecords((tableName: any), deletedRecordsToDestroy)
      : null
  })
  return Promise.all(promises)
}

const applyAllRemoteChanges = (
  db: Database,
  recordsToApply: AllRecordsToApply,
  sendCreatedAsUpdated: boolean,
  log?: SyncLog,
  conflictResolver?: SyncConflictResolver,
): Promise<void> => {
  const allRecords = []
  const preparedIdMappings = {}
  toPairs(recordsToApply).forEach(([tableName, records]) => {
    const preparedModels: Model[] = prepareApplyRemoteChangesToCollection(
      db.get((tableName: any)),
      records,
      sendCreatedAsUpdated,
      log,
      conflictResolver,
      preparedIdMappings,
    )
    if (db.useIdMapping) {
      preparedIdMappings[tableName] = preparedModels
        .filter((m) => m.table === 'id_mapping')
        .reduce((map, obj) => ((map[obj.remoteId] = obj.localId), map), {})
    }
    allRecords.push(...preparedModels)
  })
  return db.batch(allRecords)
}

// See _unsafeBatchPerCollection - temporary fix
const unsafeApplyAllRemoteChangesByBatches = (
  db: Database,
  recordsToApply: AllRecordsToApply,
  sendCreatedAsUpdated: boolean,
  log?: SyncLog,
  conflictResolver?: SyncConflictResolver,
): Promise<*> => {
  const promises = []
  const preparedIdMappings = {}
  toPairs(recordsToApply).forEach(([tableName, records]) => {
    const preparedModels: Model[] = prepareApplyRemoteChangesToCollection(
      db.collections.get((tableName: any)),
      records,
      sendCreatedAsUpdated,
      log,
      conflictResolver,
      preparedIdMappings,
    )
    if (db.useIdMapping) {
      preparedIdMappings[tableName] = preparedModels
        .filter((m) => m.table === 'id_mapping')
        .reduce((map, obj) => ((map[obj.remoteId] = obj.localId), map), {})
    }
    const batches = splitEvery(5000, preparedModels).map((recordBatch) => db.batch(recordBatch))
    promises.push(...batches)
  })
  return Promise.all(promises)
}

export default async function applyRemoteChanges(
  db: Database,
  remoteChanges: SyncDatabaseChangeSet,
  sendCreatedAsUpdated: boolean,
  log?: SyncLog,
  conflictResolver?: SyncConflictResolver,
  _unsafeBatchPerCollection?: boolean,
): Promise<void> {
  // $FlowFixMe
  const recordsToApply = await getAllRecordsToApply(db, remoteChanges)
  // Perform steps concurrently
  await Promise.all([
    destroyAllDeletedRecords(db, recordsToApply),
    _unsafeBatchPerCollection
      ? unsafeApplyAllRemoteChangesByBatches(
          db,
          recordsToApply,
          sendCreatedAsUpdated,
          log,
          conflictResolver,
        )
      : applyAllRemoteChanges(db, recordsToApply, sendCreatedAsUpdated, log, conflictResolver),
  ])
}
