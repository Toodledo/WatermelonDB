// @flow

import { logError } from '../../utils/common'

import type { Database, RecordId, Collection, Model, TableName, DirtyRaw } from '../..'

import type { SyncTableChangeSet, SyncDatabaseChangeSet } from '..'
import { mapObj } from '../../utils/fp'
import allPromisesObj from '../../utils/fp/allPromisesObj'

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

const idsForRelations = (
  { created, updated, deleted }: SyncTableChangeSet,
  columnName: string,
): RecordId[] => {
  const ids = []
  created.forEach((record) => {
    if (record[columnName]) {
      ids.push(record[columnName])
    }
  })
  updated.forEach((record) => {
    if (record[columnName]) {
      ids.push(record[columnName])
    }
  })
  return ids
}

export function convertRelatedRemoteToLocalIds(
  raw: DirtyRaw,
  relatedRecords?: RelatedRecords,
  preparedIdMappings: Object,
): void {
  if (!relatedRecords) return

  // for each relation, check if the column is set. If it is, we need to convert the remote ID to a local ID
  for (const table in relatedRecords) {
    const relation = relatedRecords[table]
    const remoteId = raw[relation.columnName]
    //first look for the localid in the existing saved mappings
    let localId = relation.mappings[remoteId]

    // if it doesn't exist there, then maybe we just created the related object so we should look in the preparedMappings
    if (!localId && preparedIdMappings && preparedIdMappings[table]) {
      localId = preparedIdMappings[table][remoteId]
    }

    // if remoteId is there (e.g. not 0 or "0") and can't find the localId, then log an error
    if (remoteId * 1 && !localId) {
      console.log(
        `[Sync] Server wants client to map a record ${table}#${remoteId} that doesn't exist locally.`,
      )
      logError(
        `[Sync] Server wants client to map a record ${table}#${remoteId} that doesn't exist locally.`,
      )
      return
    }
    if (localId) {
      raw[relation.columnName] = localId
    }
  }
}

export function convertRelatedLocalToRemoteIds(
  raw: DirtyRaw,
  relatedRecords: RelatedRecords,
  preparedIdMappings: Object,
): void {
  if (!relatedRecords) return

  // for each relation, check if the column is set. If it is, we need to convert the remote ID to a local ID
  for (const table in relatedRecords) {
    const relation = relatedRecords[table]
    const localId = raw[relation.columnName]
    //first look for the remoteid in the existing saved mappings
    let remoteId = relation.mappings[localId]

    // if it doesn't exist there, then maybe we just created the related object so we should look in the preparedMappings
    // if (!localId && preparedIdMappings && preparedIdMappings[table]) {
    //   localId = preparedIdMappings[table][remoteId];
    // }
    if (localId && !remoteId) {
      console.log(
        `[Sync] Client wants to map a record ${table}#${localId} that doesn't exist on the server.`,
      )
      logError(
        `[Sync] Client wants to map a record ${table}#${localId} that doesn't exist on the server.`,
      )
      return
    }
    if (remoteId) {
      raw[relation.columnName] = remoteId
    }
  }
}

async function fetchIdMappingsForAssociations<Object>(
  association,
  table: TableName<any>,
  changes,
  conversion: string,
  database,
): Promise<Object> {
  let mappings = {}
  if (association.type === 'belongs_to') {
    const ids = idsForRelations(changes, association.key)
    if (conversion === 'remoteToLocal') {
      mappings = await database.idMappingTable.getMappingsForRemoteIds(ids, table)
    } else {
      mappings = await database.idMappingTable.getMappingsForLocalIds(ids, table)
    }
  }

  return { columnName: association.key, mappings }
}

export type RelatedRecord = { columnName: String, mappings: Object }
export type RelatedRecords = { [TableName<any>]: RelatedRecord }
async function getAllRelatedRecordsForChanges<T: Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
  conversion: string, // 'remoteToLocal' or 'localToRemote'
): RelatedRecords {
  const { database, modelClass } = collection
  const associations = modelClass.associations

  const relatedRecords: RelatedRecords = await allPromisesObj(
    mapObj(
      async (a, table: TableName<any>) =>
        await fetchIdMappingsForAssociations(a, table, changes, conversion, database),
      associations,
    ),
  )

  return relatedRecords
}
export async function getAllRelatedLocalIdsForChanges<T: Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
): RelatedRecords {
  return getAllRelatedRecordsForChanges(collection, changes, 'remoteToLocal')
}

export async function getAllRelatedRemoteIdsForChanges<T: Model>(
  collection: Collection<T>,
  changes: SyncTableChangeSet,
): RelatedRecords {
  return getAllRelatedRecordsForChanges(collection, changes, 'localToRemote')
}

export async function convertIdsForPushedChanges(
  db: Database,
  changes: SyncDatabaseChangeSet,
): Promise<any> {
  if (!changes) return changes

  const mappedChanges = {}

  mapObj(async (tableChanges, table: TableName<any>) => {
    // console.log("TABLE TYPE " + typeof table);
    // return;
    //const tableChanges = changes[table];
    const { created, updated, deleted } = tableChanges //changes[table]
    const ids = idsForChanges(tableChanges)

    const idMappings = await db.idMappingTable.getMappingsForLocalIds(ids, table) // get local IDs to search for
    const relatedRemoteIds = await getAllRelatedRemoteIdsForChanges(db.get(table), tableChanges)

    // for created records, we can just remove the localid because it will get created on the server
    // then we'll need to make sure to save the server assigned ID once it gets created
    const mappedCreated = created.map((raw) => {
      const newCreated = Object.assign({}, raw)
      delete newCreated.id
      convertRelatedLocalToRemoteIds(newCreated, relatedRemoteIds, {})
      return newCreated
    })
    const mappedUpdated = updated.map((raw) => {
      const { id } = raw
      const remoteId = idMappings[id] //get the remoteid
      if (!remoteId) {
        logError(
          `[Sync] Looking for remoteId for ${table}#${id}, but I can't find it. Will ignore it. This is probably a Watermelon bug — please file an issue!`,
        )
        return
      }
      const newUpdated = Object.assign({}, raw, { id: remoteId }) // make sure we map the remote ID
      convertRelatedLocalToRemoteIds(newUpdated, relatedRemoteIds, {})
      return newUpdated
    })
    const mappedDeleted = deleted.map((deletedId) => idMappings[deletedId])

    const mappedChangeSet = {
      created: mappedCreated,
      updated: mappedUpdated,
      deleted: mappedDeleted,
    }
    mappedChanges[table] = mappedChangeSet
  }, changes)
  // for (const table: TableName<any> in changes ) {
  //   console.log("TABLE TYPE " + typeof(table));
  //   //table = tableName(table);
  //   //const tableChanges = changes[table];
  //   const { created, updated, deleted } = changes[table]
  //   const ids = idsForChanges(changes[table]);

  //   const idMappings = await db.idMappingTable.getMappingsForLocalIds(ids, table); // get local IDs to search for
  //   const relatedRemoteIds = await getAllRelatedRemoteIdsForChanges(db.get(table), changes[table]);

  //   // for created records, we can just remove the localid because it will get created on the server
  //   // then we'll need to make sure to save the server assigned ID once it gets created
  //   const mappedCreated = created.map((raw) => {
  //       const newCreated = Object.assign({}, raw);
  //       delete newCreated.id
  //       convertRelatedLocalToRemoteIds(newCreated, relatedRemoteIds, {});
  //       return newCreated
  //   })
  //   const mappedUpdated = updated.map((raw) => {
  //     const { id } = raw
  //     const remoteId = idMappings[id];  //get the remoteid
  //     if (!remoteId) {
  //       logError(
  //           `[Sync] Looking for remoteId for ${table}#${id}, but I can't find it. Will ignore it. This is probably a Watermelon bug — please file an issue!`,
  //         )
  //         return
  //     }
  //     const newUpdated = Object.assign({}, raw, {id: remoteId});    // make sure we map the remote ID
  //     convertRelatedLocalToRemoteIds(newUpdated, relatedRemoteIds, {});
  //     return newUpdated;
  //   });
  //   const mappedDeleted = deleted.map((deletedId)=> (idMappings[deletedId]));

  //   const mappedChangeSet = {
  //       created: mappedCreated,
  //       updated: mappedUpdated,
  //       deleted: mappedDeleted,
  //   }
  //   mappedChanges[table] = mappedChangeSet
  // }
  return mappedChanges
}
