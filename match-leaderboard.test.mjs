// 头像撑瓶 · 撑破榜单测
import test from 'node:test';
import assert from 'node:assert/strict';
import { BurstBoard, sanitizeBoard } from './match-leaderboard.mjs';

function memoryStorage() {
  let value = null;
  return {
    read: () => value,
    write: (v) => { value = v; },
    get raw() { return value; }
  };
}

test('记录撑破：同一个人累加，榜首按次数排', () => {
  const board = new BurstBoard({ storage: memoryStorage() });
  board.record({ name: '小明', at: 1 });
  board.record({ name: '小红', at: 2 });
  board.record({ name: '小红', at: 3 });
  assert.equal(board.total, 3);
  assert.equal(board.top(2)[0].name, '小红');
  assert.equal(board.countOf('小红'), 2);
  assert.equal(board.countOf('路人'), 0);
});

test('空名字不记，脏数据不会让榜单崩', () => {
  const board = new BurstBoard({ storage: memoryStorage() });
  assert.equal(board.record({ name: '   ' }), null);
  assert.equal(board.total, 0);
  const dirty = sanitizeBoard({
    total: 'x',
    people: [null, { name: 'A', count: -3 }, { name: 'A', count: 2 }, { name: 'B', count: 1.7 }, { name: '', count: 9 }]
  });
  assert.deepEqual(dirty.people.map((p) => [p.name, p.count]), [['A', 2], ['B', 2]]);
  assert.equal(dirty.total, 4);
});

test('持久化：写进去的榜，下次构造能读出来', () => {
  const storage = memoryStorage();
  const first = new BurstBoard({ storage });
  first.record({ name: '夜猫子' });
  first.record({ name: '夜猫子' });
  const second = new BurstBoard({ storage });
  assert.equal(second.countOf('夜猫子'), 2);
  assert.equal(second.total, 2);
});

test('坏 JSON / 抛异常的 storage 都当空榜处理', () => {
  const bad = { read: () => '{not json', write: () => { throw new Error('denied'); } };
  const board = new BurstBoard({ storage: bad });
  assert.equal(board.total, 0);
  assert.doesNotThrow(() => board.record({ name: 'A' }));
  assert.equal(board.countOf('A'), 1);
});

test('清榜', () => {
  const storage = memoryStorage();
  const board = new BurstBoard({ storage });
  board.record({ name: 'A' });
  board.clear();
  assert.equal(board.total, 0);
  assert.deepEqual(board.top(5), []);
});
