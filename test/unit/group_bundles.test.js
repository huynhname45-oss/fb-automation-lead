import test from 'node:test';
import assert from 'node:assert/strict';

/**
 * Group Bundle Helper Functions (matching app.js implementation)
 */
export function createBundle(name, color = '#4f46e5', initialGroupIds = []) {
  if (!name || typeof name !== 'string' || !name.trim()) {
    throw new Error('Tên nhóm lớn không được để trống!');
  }
  return {
    id: `bundle_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
    name: name.trim(),
    color: color || '#4f46e5',
    groupIds: Array.from(new Set(initialGroupIds.map(String).filter(Boolean))),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export function addGroupsToBundle(bundle, groupIds = []) {
  const currentSet = new Set(bundle.groupIds || []);
  groupIds.forEach(id => {
    if (id && String(id).trim()) {
      currentSet.add(String(id).trim());
    }
  });
  bundle.groupIds = Array.from(currentSet);
  bundle.updatedAt = new Date().toISOString();
  return bundle;
}

export function removeGroupsFromBundle(bundle, groupIds = []) {
  const toRemove = new Set(groupIds.map(String).filter(Boolean));
  bundle.groupIds = (bundle.groupIds || []).filter(id => !toRemove.has(String(id)));
  bundle.updatedAt = new Date().toISOString();
  return bundle;
}

export function filterGroupsByBundle(groups = [], bundleId = 'all', bundles = []) {
  if (!bundleId || bundleId === 'all') {
    return groups;
  }
  if (bundleId === 'unassigned') {
    const allAssignedIds = new Set();
    bundles.forEach(b => (b.groupIds || []).forEach(id => allAssignedIds.add(id)));
    return groups.filter(g => !allAssignedIds.has(String(g.id)));
  }
  const targetBundle = bundles.find(b => b.id === bundleId);
  if (!targetBundle) return groups;
  const bundleGroupIds = new Set((targetBundle.groupIds || []).map(String));
  return groups.filter(g => bundleGroupIds.has(String(g.id)));
}

test('createBundle: correctly creates a bundle with unique IDs', () => {
  const b = createBundle('Hội Quán Cafe & F&B', '#059669', ['1001', '1002', '1001']);
  assert.equal(b.name, 'Hội Quán Cafe & F&B');
  assert.equal(b.color, '#059669');
  assert.deepEqual(b.groupIds, ['1001', '1002']);
  assert.ok(b.id.startsWith('bundle_'));
  assert.ok(b.createdAt);
});

test('createBundle: rejects empty bundle name', () => {
  assert.throws(() => createBundle('   '), /không được để trống/);
  assert.throws(() => createBundle(null), /không được để trống/);
});

test('addGroupsToBundle & removeGroupsFromBundle: correctly modifies groupIds list', () => {
  const b = createBundle('Nhóm Máy POS', '#4f46e5', ['111']);
  addGroupsToBundle(b, ['222', '333', '111']);
  assert.deepEqual(b.groupIds, ['111', '222', '333']);

  removeGroupsFromBundle(b, ['222', '999']);
  assert.deepEqual(b.groupIds, ['111', '333']);
});

test('filterGroupsByBundle: filters groups accurately by bundle', () => {
  const allGroups = [
    { id: '101', name: 'Nhóm 1' },
    { id: '102', name: 'Nhóm 2' },
    { id: '103', name: 'Nhóm 3' },
    { id: '104', name: 'Nhóm 4' }
  ];

  const bundleFB = createBundle('F&B', '#059669', ['101', '103']);
  const bundlePOS = createBundle('POS', '#d97706', ['102']);
  const bundles = [bundleFB, bundlePOS];

  // 1. All
  const filteredAll = filterGroupsByBundle(allGroups, 'all', bundles);
  assert.equal(filteredAll.length, 4);

  // 2. F&B Bundle
  const filteredFB = filterGroupsByBundle(allGroups, bundleFB.id, bundles);
  assert.equal(filteredFB.length, 2);
  assert.deepEqual(filteredFB.map(g => g.id), ['101', '103']);

  // 3. Unassigned
  const filteredUnassigned = filterGroupsByBundle(allGroups, 'unassigned', bundles);
  assert.equal(filteredUnassigned.length, 1);
  assert.equal(filteredUnassigned[0].id, '104');
});
