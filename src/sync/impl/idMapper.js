import { logError, } from '../../utils/common'
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

export async function mapIdsForPushedChanges(
    db: Database,
    changes: SyncDatabaseChangeSet,
  ): Promise<void> {
    if (!changes) return changes;

    const mappedChanges = {};

    for (const table in changes ) {
        const ids = idsForChanges(changes[(table: any)]);
        // get local IDs to search for
        const idMappings = await db.idMappingTable.getMappingsForLocalIds(ids);
        
        const { created, updated, deleted } = changes[(table: any)]

        // for created records, we can just remove the localid because it will get created on the server
        // then we'll need to make sure to save the server assigned ID once it gets created
        const mappedCreated = created.map((raw) => {
            const newCreated = Object.assign({}, raw);
            delete newCreated.id
            return newCreated
        })
        const mappedUpdated = updated.map((raw) => {
          const { id } = raw
          const remoteId = idMappings[id];  //get the remoteid
          if (!remoteId) {
            logError(
                `[Sync] Looking for remoteId for ${table}#${id}, but I can't find it. Will ignore it. This is probably a Watermelon bug — please file an issue!`,
              )
              return
          }
          const newUpdated = Object.assign({}, raw, {id: remoteId});    // make sure we map the remote ID
          return newUpdated;
        });
        const mappedDeleted = deleted.map((deletedId)=> (idMappings[deletedId]));

        const mappedChangeSet = {
            created: mappedCreated,
            updated: mappedUpdated,
            deleted: mappedDeleted,
        }
        mappedChanges[table] = mappedChangeSet
    }
    return mappedChanges;
}