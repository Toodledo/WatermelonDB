// @flow
import Model from '../../Model'
import { tableSchema, tableName, type TableName, type TableSchema, columnName } from '../../Schema'

import Database from '../../Database'
import { field, text } from '../../decorators'

import Collection from '../../Collection'
import * as Q from '../../QueryDescription'

export const IdMappingSchema: TableSchema = tableSchema({
    name: tableName('id_mapping'),
    columns: [
        { name: columnName('local_id'), type: 'string' },
        { name: columnName('remote_id'), type: 'string'},
        { name: columnName('type'), type: 'string'}
    ]
});

export class IdMappingModel extends Model {
    static table:TableName<any> = tableName('id_mapping')

	@text('local_id') localId: string
    @text('remote_id') remoteId: string
    @text('type') type: string
}

export default class IdMapping {
    _collection: Collection<IdMappingModel>
  
    constructor(database: Database): void {
      this._collection = new Collection(database, IdMappingModel);
    }

    // get local ID for the specified remoteID
    getLocalId(remoteId: string, table:string): Promise<string|null> {
        return this._collection.query(Q.and(
                Q.where(columnName('remote_id'), Q.eq(remoteId)),
                Q.where(columnName('type'), Q.eq(table))
            )).fetch().then(r=>{
                if (r.length > 0) {
                    return r[0].localId
                }
                return null;
            })
    }

    // get all IDs 
    getLocalIds(remoteIds: string[], table:string): Promise<string[]> {
        if (remoteIds.length) {
            return this._collection.query(Q.and(
                Q.where(columnName('remote_id'), Q.oneOf(remoteIds)),
                Q.where(columnName('type'), Q.eq(table))
            )).fetch().then(idMappings=>
                idMappings.map(i=>i.localId)
            );
        }
        return Promise.resolve([])
    }

    getMappingsForRemoteIds(remoteIds: string[], table: string): Promise<Object> {
        if (remoteIds.length) {
            return this._collection.query(Q.and(
                Q.where(columnName('remote_id'), Q.oneOf(remoteIds)),
                Q.where(columnName('type'), Q.eq(table))
            )).fetch().then(idMappings=> {
                // convert to a map of {remoteId: localId} mappings
                return idMappings.reduce((map, obj) => (map[obj.remoteId] = obj.localId, map), {});
            })
        }
        return Promise.resolve({})
    }

    getAllMappings(): Promise<Object> {
        return this._collection.query().fetch().then(idMappings=> {
            // convert to a map of {localId: remoteId} mappings
            return idMappings.reduce((map, obj) => (map[obj.localId] = obj.remoteId, map), {});
        })
    }

    getMappingsForLocalIds(localIds: string[], table: string): Promise<Object> {
        //return this._collection.query().fetch();
        if (localIds.length) {
            return this._collection.query(Q.and(
                Q.where(columnName('local_id'), Q.oneOf(localIds)),
                Q.where(columnName('type'), Q.eq(table))
            )).fetch().then(idMappings=> {
                // convert to a map of {localId: remoteId} mappings
                return idMappings.reduce((map, obj) => (map[obj.localId] = obj.remoteId, map), {});
            })
        }
        return Promise.resolve({})
    }

    prepareCreateMapping(localId: string, remoteId: string, type: string): IdMappingModel {
        return this._collection.prepareCreate(r=> {
            r.localId = localId;
            r.remoteId = remoteId;
            r.type = type
        })
    }
  }
  