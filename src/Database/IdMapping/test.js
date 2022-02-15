import { mockDatabase, MockProject, MockTask } from '../../__tests__/testModels'
import Model from '../../Model'

describe('IdMapping', () => {
  it('can initialize and get models', () => {
    const { db } = mockDatabase()
    // const map = new CollectionMap(db, [MockProject, MockTask])

    // expect(map.get('mock_projects').modelClass).toBe(MockProject)
    // expect(map.get('mock_projects').table).toBe('mock_projects')
    // expect(map.get('mock_tasks').modelClass).toBe(MockTask)
    // expect(map.get('mock_tasks').table).toBe('mock_tasks')
  })
  it(`returns null for collections that don't exist`, () => {
    const { db } = mockDatabase()
    // const map = new CollectionMap(db, [MockProject, MockTask])

    // expect(map.get('mock_comments')).toBe(null)
    // expect(map.get('does_not_exist')).toBe(null)
  })
})
