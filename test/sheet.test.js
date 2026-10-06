const test = require('node:test');
const assert = require('node:assert');
const { parseAllotment, orderBeds } = require('../src/sheet');

const csv = `Rooms No,Bed no ,Clean or Not Clean 
A,1,Leave
,2,Change Bedsheet
,3,Set
B,4,Set
,5,Change Bedsheet
C,6,
`;

test('carries the room down and reads the dropdown values', () => {
  const beds = parseAllotment(csv);
  assert.deepStrictEqual(beds.map(b => `${b.room}${b.bed}:${b.action}`),
    ['A1:leave', 'A2:change', 'A3:set', 'B4:set', 'B5:change', 'C6:leave']);
});

test('keeps sheet room order, change before set inside a room', () => {
  const ordered = orderBeds(parseAllotment(csv));
  assert.deepStrictEqual(ordered.map(b => b.room + b.bed), ['A2', 'A3', 'A1', 'B5', 'B4', 'C6']);
  assert.deepStrictEqual(ordered.map(b => b.position), [0, 1, 2, 3, 4, 5]);
});
