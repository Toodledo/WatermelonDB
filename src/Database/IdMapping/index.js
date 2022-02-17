
import Model from '../../Model'
import { tableSchema } from '../../Schema'

import { field, text } from '../../decorators'

import Collection from '../../Collection'
import * as Q from '../../QueryDescription'

export const IdMappingSchema = tableSchema({
    name: 'id_mapping',
    columns: [
        { name: 'local_id', type: 'string' },
        { name: 'remote_id', type: 'string'},
        { name: 'type', type: 'string'}
    ]
});

export class IdMappingModel extends Model {
    static table = 'id_mapping'

	@text('local_id') localId
    @text('remote_id') remoteId
    @text('type') type
}

export default class IdMapping {
    _collection: Collection
  
    constructor(database: Database): void {
      this._collection = new Collection(database, IdMappingModel);
    }

    // get local ID for the specified remoteID
    getLocalId<String>(remoteId: String, table:String): String {
        return this._collection.query(Q.and(
                Q.where('remote_id', Q.eq(remoteId)),
                Q.where('type', Q.eq(table))
            )).fetch().then(r=>{
                if (r.length > 0) {
                    return r[0].localId
                }
                return null;
            })
    }

    // get all IDs 
    getLocalIds(remoteIds: String[], table:String): String[] {
        if (remoteIds.length) {
            return this._collection.query(Q.and(
                Q.where('remote_id', Q.oneOf(remoteIds)),
                Q.where('type', Q.eq(table))
            )).fetch().then(idMappings=>
                idMappings.map(i=>i.localId)
            );
        }
        return Promise.resolve([])
    }

    getMappingsForRemoteIds(remoteIds: String[], table: String): IdMappingModel[]{
        if (remoteIds.length) {
            return this._collection.query(Q.and(
                Q.where('remote_id', Q.oneOf(remoteIds)),
                Q.where('type', Q.eq(table))
            )).fetch().then(idMappings=> {
                // convert to a map of {remoteId: localId} mappings
                return idMappings.reduce((map, obj) => (map[obj.remoteId] = obj.localId, map), {});
            })
        }
        return Promise.resolve({})
    }

    getAllMappings(): Object[] {
        return this._collection.query().fetch().then(idMappings=> {
            // convert to a map of {localId: remoteId} mappings
            return idMappings.reduce((map, obj) => (map[obj.localId] = obj.remoteId, map), {});
        })
    }

    getMappingsForLocalIds(localIds: String[]): IdMappingModel[] {
        //return this._collection.query().fetch();
        if (localIds.length) {
            return this._collection.query(Q.where('local_id', Q.oneOf(localIds))).fetch().then(idMappings=> {
                // convert to a map of {localId: remoteId} mappings
                return idMappings.reduce((map, obj) => (map[obj.localId] = obj.remoteId, map), {});
            })
        }
        return Promise.resolve({})
    }

    prepareCreateMapping(localId: String, remoteId: String, type: String) {
        return this._collection.prepareCreate(r=> {
            r.localId = localId;
            r.remoteId = remoteId;
            r.type = type
        })
    }
  }
  