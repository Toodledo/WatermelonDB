
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
    getLocalId<String>(remoteId: String): String {
        return this._collection.query(Q.where('remote_id', Q.eq(remoteId))).fetch().then(r=>{
            if (r.length > 0) {
                return r[0].localId
            }
            return null;
        })
    }

    // get all IDs 
    getLocalIds(remoteIds: String[]): String[] {
        if (remoteIds.length) {
            return this._collection.query(Q.where('remote_id', Q.oneOf(remoteIds))).fetch().then(idMappings=>
                idMappings.map(i=>i.localId)
            );
        }
        return Promise.resolve([])
    }

    getMappingsForRemoteIds(remoteIds: String[]): IdMappingModel[]{
        if (remoteIds.length) {
            return this._collection.query(Q.where('remote_id', Q.oneOf(remoteIds))).fetch()
        }
        return Promise.resolve([])
    }

    getAllMappings(): Object[] {
        return this._collection.query().fetch().then(idMappings=> {
            const localToRemoteMap = {}
            idMappings.forEach(id=>{ 
                localToRemoteMap[id.localId] = id.remoteId;
            });
            return localToRemoteMap;
        })
    }

    getMappingsForLocalIds(localIds: String[]): IdMappingModel[] {
        //return this._collection.query().fetch();
        if (localIds.length) {
            return this._collection.query(Q.where('local_id', Q.oneOf(localIds))).fetch().then(idMappings=> {
                const localToRemoteMap = {}
                idMappings.forEach(id=>{ 
                    localToRemoteMap[id.localId] = id.remoteId;
                });
                return localToRemoteMap;
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
  