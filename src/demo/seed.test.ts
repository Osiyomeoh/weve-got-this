import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CareStore } from '../store/store.ts';
import { seedDemoHousehold, DEMO_HOUSEHOLD_ID } from './seed.ts';

const name = (store: CareStore): string => store.getCareState(DEMO_HOUSEHOLD_ID).household.name;

test('a demo family seeded under the old name is renamed on the next start', async () => {
  const store = new CareStore();
  await store.addHousehold({
    id: DEMO_HOUSEHOLD_ID,
    name: "Daddy's care circle",
    timezone: 'Africa/Lagos',
  });
  await seedDemoHousehold(store);
  assert.equal(name(store), "Daddy's circle");
});

test('a name the family chose is kept', async () => {
  const store = new CareStore();
  await store.addHousehold({
    id: DEMO_HOUSEHOLD_ID,
    name: 'The Adeyemis',
    timezone: 'Africa/Lagos',
  });
  await seedDemoHousehold(store);
  assert.equal(name(store), 'The Adeyemis');
});

test('a visitor copy of another family is renamed by its own old name', async () => {
  const store = new CareStore();
  const id = `${DEMO_HOUSEHOLD_ID}~v1`;
  await store.addHousehold({ id, name: "Mama's care circle", timezone: 'Africa/Lagos' });
  await seedDemoHousehold(store, { suffix: '~v1', careCase: 'memory' });
  assert.equal(store.getCareState(id).household.name, "Mama's circle");
});
