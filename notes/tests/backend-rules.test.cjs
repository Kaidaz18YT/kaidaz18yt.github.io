/* Contract tests for the example rules, not the live BreadBackend evaluator. */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '../backend-rules.json'), 'utf8'));
const owner = { uid: 'owner-123', email: 'kaioliver111@gmail.com' };
const other = { uid: 'other-456', email: 'other@example.com' };
const collectionNames = ['projects', 'tasks', 'notes'];

function permitted(collection, operation, auth, oldData = {}, newData = {}) {
  const rule = rules.collections[collection][operation];
  assert.ok(rule && typeof rule.expr === 'string', `${collection}.${operation} needs an expression`);
  try {
    return vm.runInNewContext(rule.expr, {
      request: { auth, data: newData }, resource: { data: oldData },
    }, { timeout: 100 }) === true;
  } catch (_) {
    // Missing auth should not grant access in this local simulation.
    return false;
  }
}

test('default rules deny client access and cover exactly the Ledger collections', () => {
  assert.deepEqual(rules.default, { read: { allow: 'never' }, write: { allow: 'never' } });
  assert.deepEqual(Object.keys(rules.collections).sort(), collectionNames.slice().sort());
  for (const name of collectionNames) {
    assert.deepEqual(Object.keys(rules.collections[name]).sort(), ['create', 'delete', 'read', 'update']);
  }
});

for (const name of collectionNames) {
  test(`${name}: permits the selected owner and denies anonymous or other accounts`, () => {
    const ownDocument = { ownerId: owner.uid };
    for (const operation of ['read', 'delete']) {
      assert.equal(permitted(name, operation, owner, ownDocument), true);
      assert.equal(permitted(name, operation, null, ownDocument), false);
      assert.equal(permitted(name, operation, other, ownDocument), false);
      assert.equal(permitted(name, operation, other, { ownerId: other.uid }), false);
      assert.equal(permitted(name, operation, owner, { ownerId: other.uid }), false);
    }
    assert.equal(permitted(name, 'create', owner, {}, ownDocument), true);
    assert.equal(permitted(name, 'create', owner, {}, { ownerId: other.uid }), false);
    assert.equal(permitted(name, 'create', other, {}, { ownerId: other.uid }), false);
    assert.equal(permitted(name, 'create', null, {}, ownDocument), false);
    assert.equal(permitted(name, 'update', owner, ownDocument, ownDocument), true);
    assert.equal(permitted(name, 'update', owner, ownDocument, { ownerId: other.uid }), false);
    assert.equal(permitted(name, 'update', owner, ownDocument, {}), false);
    assert.equal(permitted(name, 'update', owner, { ownerId: other.uid }, ownDocument), false);
    assert.equal(permitted(name, 'update', other, ownDocument, ownDocument), false);
    assert.equal(permitted(name, 'update', null, ownDocument, ownDocument), false);
  });
}
