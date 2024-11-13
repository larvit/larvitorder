import { Order } from '../src/order';
import { OrderLib } from '../src/index';
import * as uuidLib from 'uuid';
import assert, { AssertionError } from 'assert';
import { Log, Utils } from 'larvitutils';
import Db from 'larvitdb';
import { Row } from '../src/row';

const log = new Log('error');
const lUtils = new Utils();

let db: any;
let dbConf: any;
let orderLib: OrderLib;

before(() => {
	// Run DB Setup
	let confFile = '';

	if (process.env.TRAVIS) {
		confFile = __dirname + '/../config/db_travis.json';
	} else if (process.env.DBCONFFILE) {
		confFile = process.env.DBCONFFILE;
	} else {
		confFile = __dirname + '/../config/db_test.json';
	}

	log.verbose('DB config file: "' + confFile + '"');

	// eslint-disable-next-line @typescript-eslint/no-var-requires
	dbConf = require(confFile);
	log.verbose('DB config: ' + JSON.stringify(dbConf));
});

describe('Lib', () => {
	beforeEach(async () => {
		db = new Db({
			...dbConf,
			log,
		});

		await db.removeAllTables();

		orderLib = new OrderLib({
			db,
			log,
		});

		await orderLib.runDbMigrations();
	});

	it('should load fields to cache and not crash', async () => {
		assert.doesNotReject(async () => await orderLib.loadOrderFieldsToCache());
	});
});

describe('dbConf - dateStrings: true', () => {
	beforeEach(async () => {
		const conf = {
			...dbConf,
			dateStrings: true,
		};

		db = new Db({
			...conf,
			log,
		});

		await db.removeAllTables();

		orderLib = new OrderLib({
			db,
			log,
		});

		await orderLib.runDbMigrations();
	});

	describe('Order', () => {
		it('should save and load saved order from db', async () => {
			const order = orderLib.createOrder({
				fields: {
					korv: 'tolv',
				},
				rows: [{
					wurst: 'käse',
				}],
			});

			await order.save();

			const loadedOrder = await orderLib.loadOrder(order.uuid);

			assert.ok(loadedOrder);
			assert.strictEqual(loadedOrder.uuid, order.uuid);
			assert.strictEqual(loadedOrder.created, order.created);
			assert.strictEqual(loadedOrder.fields.korv[0], 'tolv');
			assert.strictEqual(loadedOrder.rows.length, 1);
			assert.deepStrictEqual(loadedOrder.rows, order.rows);

			// Make sure that we can save order again without getting error
			await loadedOrder.save();
		});

		it('should save order with created in timezone and get it in utc', async () => {
			const order = orderLib.createOrder({
				created: '2022-12-01T13:37:00+01:00',
			});

			await order.save();

			const loadedOrder = await orderLib.loadOrder(order.uuid);

			assert.ok(loadedOrder);
			assert.strictEqual(loadedOrder.created, '2022-12-01T12:37:00.000Z');
			assert.ok(loadedOrder.updated);
			assert.notStrictEqual(loadedOrder.updated, '2022-12-01T12:37:00.000Z');

			// Make sure that we can save order again without getting error
			await loadedOrder.save();
		});
	});
});

describe('dbConf - dateStrings: false', () => {
	beforeEach(async () => {
		const conf = {
			...dbConf,
			dateStrings: false,
		};

		db = new Db({
			...conf,
			log,
		});

		await db.removeAllTables();

		orderLib = new OrderLib({
			db,
			log,
		});

		await orderLib.runDbMigrations();
	});

	describe('Order', () => {
		describe('Create', () => {
			it('should instantiate a new plain order object', () => {
				const order = new Order({ db, log });

				assert.strictEqual(uuidLib.validate(order.uuid), true);
				assert.strictEqual(typeof order.created, 'string');
				assert.strictEqual(order.rows instanceof Array, true);
				assert.strictEqual(order.rows.length, 0);
			});

			it('should instantiate a new plain order object, using orderlib', () => {
				const order = orderLib.createOrder();

				assert.strictEqual(uuidLib.validate(order.uuid), true);
				assert.strictEqual(order.rows instanceof Array, true);
				assert.strictEqual(order.rows.length, 0);
			});

			it('should instantiate a new plain order object, with custom uuid', () => {
				const uuid = '7ce6ebde-b9a8-11e6-a4a6-cec0c932ce01';
				const order = orderLib.createOrder({ uuid });

				assert.strictEqual(order.uuid, uuid);
			});

			it('should generate row uuid if not specified', () => {
				const order = orderLib.createOrder({
					rows: [{ name: 'value' }],
				});

				assert.strictEqual(uuidLib.validate(order.rows[0].uuid || ''), true);
			});

			it('should instantiate a new plain order object with custom fields and rows', () => {
				const orderFields = { firstname: 'Nisse', lastname: ['Struts'], active: 'true' };
				const rows: Row[] = [
					{ uuid: uuidLib.v4(), price: 1337, name: 'nisse' },
					{ uuid: uuidLib.v4(), price: 1338, name: 'nisse2' },
				];
				const order = orderLib.createOrder({
					fields: orderFields,
					rows,
				});

				assert.deepStrictEqual(order.fields, orderFields);
				assert.deepStrictEqual(order.rows, rows);
			});
		});

		describe('Load', () => {
			it('should return undefined when trying to load non-existing order', async () => {
				const order = await orderLib.loadOrder(uuidLib.v1());
				assert.strictEqual(order, undefined);
			});

			it('should return empty fields and rows if an order is created with them set but load fails to find order', async () => {
				const uuid = uuidLib.v4();
				const order = await orderLib.createOrder({
					uuid,
					fields: { f1: 'v1' },
					rows: [{ r1: 'v1' }],
				});

				assert.strictEqual(Object.keys(order.fields).length, 1);
				assert.strictEqual(order.rows.length, 1);

				await order.loadFromDb();
				assert.strictEqual(Object.keys(order.fields).length, 0);
				assert.strictEqual(order.rows.length, 0);
			});
		});

		describe('Save', () => {
			it('should save an order and verify db', async () => {
				async function createOrder(): Promise<Order> {
					const order = orderLib.createOrder();
					order.fields = { firstname: 'Migal', lastname: ['Göransson', 'Kollektiv'], active: 'true' };
					order.rows = [{ price: 399, name: 'plutt' }, { price: 34, tags: ['foo', 'bar'] }];

					await order.save();

					return order;
				}

				async function checkOrder(order: Order): Promise<void> {
					async function checkFields(): Promise<void> {
						const { rows } = await db.query('SELECT * FROM orders_orderFields');
						assert.strictEqual(rows.length, 3);

						for (const row of rows) {
							assert.notStrictEqual(row.uuid, undefined);
							assert.notStrictEqual(['active', 'firstname', 'lastname'].indexOf(row.name), -1);
						}
					}

					// Check order fields
					async function checkFieldValues(): Promise<void> {
						const { rows: dbRows } = await db.query('SELECT * FROM orders_orders_fields');

						assert.strictEqual(dbRows.length, 4);

						for (const row of dbRows) {
							assert.strictEqual(lUtils.formatUuid(row.orderUuid), order.uuid);
							assert.notStrictEqual(lUtils.formatUuid(row.fieldUuid), false);
							assert.notStrictEqual(['Migal', 'Göransson', 'Kollektiv', 'true'].indexOf(row.fieldValue), -1);
						}
					}

					// Check rowfields
					async function checkRowFields(): Promise<void> {
						const { rows: dbRows } = await db.query('SELECT * FROM orders_rowFields ORDER BY name');
						assert.strictEqual(dbRows.length, 4);

						for (const row of dbRows) {
							assert.notStrictEqual(lUtils.formatUuid(row.uuid), false);
							assert.notStrictEqual(['price', 'name', 'tags', 'sortOrder'].indexOf(row.name), -1);
						}
					}

					async function checkRows(): Promise<void> {
						const { rows: dbRows } = await db.query('SELECT * FROM orders_rows');
						assert.strictEqual(dbRows.length, 2);
					}

					async function checkRowFieldValues(): Promise<void> {
						const { rows: dbRows } = await db.query('SELECT rowIntValue, rowStrValue FROM orders_rows_fields');
						const expectedRows = [
							{ rowIntValue: 399, rowStrValue: null },
							{ rowIntValue: null, rowStrValue: 'plutt' },
							{ rowIntValue: 34, rowStrValue: null },
							{ rowIntValue: null, rowStrValue: 'foo' },
							{ rowIntValue: null, rowStrValue: 'bar' },
							{ rowIntValue: 0, rowStrValue: null },
							{ rowIntValue: 1, rowStrValue: null },
						];

						assert.strictEqual(dbRows.length, expectedRows.length);
						for (const expectedRow of expectedRows) {
							if (!dbRows.find((r: any) => JSON.stringify(r) === JSON.stringify(expectedRow))) {
								throw new AssertionError({
									message: `Expected row was not found in db, row: ${JSON.stringify(expectedRow)}`,
								});
							}
						}
					}

					await checkFields();
					await checkFieldValues();
					await checkRowFields();
					await checkRows();
					await checkRowFieldValues();
				}

				const order = await createOrder();
				await checkOrder(order);
			});

			it('should save and load saved order from db', async () => {
				const order = orderLib.createOrder({
					fields: {
						korv: 'tolv',
					},
					rows: [{
						wurst: 'käse',
					}],
				});

				await order.save();

				const loadedOrder = await orderLib.loadOrder(order.uuid);

				assert.ok(loadedOrder);
				assert.strictEqual(loadedOrder.uuid, order.uuid);
				assert.strictEqual(loadedOrder.created, order.created);
				assert.strictEqual(loadedOrder.fields.korv[0], 'tolv');
				assert.strictEqual(loadedOrder.rows.length, 1);
				assert.deepStrictEqual(loadedOrder.rows, order.rows);
			});

			it('should save order but fields that are undefined or null should not be saved', async () => {
				const order = orderLib.createOrder({
					fields: {
						korv: 'tolv',
						nope: null as any,
						not: undefined as any,
					},
					rows: [{
						wurst: 'käse',
						nope: null as any,
						not: undefined as any,
					}],
				});

				await order.save();

				const loadedOrder = await orderLib.loadOrder(order.uuid);

				assert.ok(loadedOrder);
				assert.strictEqual(Object.keys(loadedOrder.fields).length, 1);
				assert.strictEqual(loadedOrder.rows.length, 1);
				assert.strictEqual(Object.keys(loadedOrder.rows[0]).length, 2); // (including uuid)
			});

			it('should save an order without fields and rows', async () => {
				const order = orderLib.createOrder();
				await order.save();

				const loadedOrder = await orderLib.loadOrder(order.uuid);

				assert.ok(loadedOrder);
				assert.strictEqual(loadedOrder.uuid, order.uuid);
				assert.strictEqual(Object.keys(loadedOrder.fields).length, 0);
				assert.strictEqual(loadedOrder.rows.length, 0);
			});

			it('should alter an order already saved to db', async () => {
				const order = orderLib.createOrder({
					fields: {
						korv: 'tolv',
						name: 'asdf',
					},
					rows: [
						{ wurst: 'käse' },
						{ wurst: 'dennis' },
					],
				});

				await order.save();

				const changeOrder = await orderLib.loadOrder(order.uuid);
				assert.ok(changeOrder);
				delete changeOrder.fields.name;
				changeOrder.rows.splice(1, 1); // Remove last row
				changeOrder.fields.korv = 'kurv';
				changeOrder.rows.push({ wurst: 'brat' });
				await changeOrder.save();

				const loadedOrder = await orderLib.loadOrder(order.uuid);
				assert.ok(loadedOrder);
				assert.strictEqual(loadedOrder.fields.name, undefined);
				assert.strictEqual(loadedOrder.fields.korv[0], 'kurv');
				assert.strictEqual(loadedOrder.rows.length, 2);
				assert.deepStrictEqual(loadedOrder.rows[0], changeOrder.rows[0]);
				assert.deepStrictEqual(loadedOrder.rows[1], changeOrder.rows[1]);
			});

			it('should maintain sort order on rows', async () => {
				const order = await orderLib.createOrder({
					fields: { firstname: 'Migal', active: 'true' },
					rows: [
						{ price: 399, name: 'plutt' },
						{ price: 34, name: 'stack' },
						{ price: 18, name: 'boll' },
						{ price: 83, name: 'krita' },
					],
				});

				await order.save();

				// Check order after first save, reorder and save again
				const firstLoad = await orderLib.loadOrder(order.uuid);
				assert.ok(firstLoad);
				assert.deepStrictEqual(firstLoad.rows[0].price, [399]);
				assert.deepStrictEqual(firstLoad.rows[1].price, [34]);
				assert.deepStrictEqual(firstLoad.rows[2].price, [18]);
				assert.deepStrictEqual(firstLoad.rows[3].price, [83]);

				// Sort rows on price and save
				order.rows.sort((a, b) => Number(String(a.price)) - Number(String(b.price)));

				await order.save();

				// Check order after the second save
				const secondLoad = await orderLib.loadOrder(order.uuid);
				assert.ok(secondLoad);
				assert.deepStrictEqual(secondLoad.rows[0].price, [18]);
				assert.deepStrictEqual(secondLoad.rows[1].price, [34]);
				assert.deepStrictEqual(secondLoad.rows[2].price, [83]);
				assert.deepStrictEqual(secondLoad.rows[3].price, [399]);
			});

			it('should save an order multiple times and verify database structure', async () => {
				const order = orderLib.createOrder({
					fields: { firstname: 'Migal', lastname: ['Göransson', 'Kollektiv'], active: 'true' },
					rows: [{ price: 399, name: 'plutt' }, { price: 34, tags: ['foo', 'bar'] }],
				});

				for (let i = 0; i < 12; i++) {
					await order.save();
				}

				const sql = 'SELECT of.*, f.name AS fieldName FROM orders_orders_fields of JOIN orders_orderFields f ON f.uuid = of.fieldUuid WHERE orderUuid = ?';
				const { rows: dbRows } = await db.query(sql, lUtils.uuidToBuffer(order.uuid));
				// Check the amount of saved order fields, should only be 4
				assert.strictEqual(dbRows.length, 4);
			});

			it('should save order with created in timezone and get it in utc', async () => {
				const order = orderLib.createOrder({
					created: '2022-12-01T13:37:00+01:00',
				});

				await order.save();

				const loadedOrder = await orderLib.loadOrder(order.uuid);

				assert.ok(loadedOrder);
				assert.strictEqual(loadedOrder.created, '2022-12-01T12:37:00.000Z');

				// Make sure that we can save order again without getting error
				await loadedOrder.save();
			});

			it('should throw an error if trying to save with invlida created date', async () => {
				const order = orderLib.createOrder({
					created: 'not-a-date',
				});

				await assert.rejects(order.save(), new Error('created is not an valid ISO-8601 date'));
			});
		});

		describe('Remove', () => {
			it('should remove an order and verify in db', async () => {
				const order = orderLib.createOrder({
					fields: { field: 'value' },
					rows: [{ rowField: 'rowValue' }],
				});
				await order.save();
				await orderLib.removeOrder(order.uuid);

				async function queryAndCheckForZeroRows(sql: string): Promise<void> {
					const { rows } = await db.query(sql);
					assert.strictEqual(rows.length, 0, `Found rows in db when expected not to, sql: "${sql}`);
				}

				await queryAndCheckForZeroRows('SELECT * FROM orders');
				await queryAndCheckForZeroRows('SELECT * FROM orders_orders_fields');
				await queryAndCheckForZeroRows('SELECT * FROM orders_rows');
				await queryAndCheckForZeroRows('SELECT * FROM orders_rows_fields');

				// Order fields and row fields are not removed
				const { rows: orderFields } = await db.query('SELECT * FROM orders_orderFields');
				assert.strictEqual(orderFields.length, 1);
				assert.strictEqual(orderFields[0].name, 'field');

				const { rows: rowFields } = await db.query('SELECT * FROM orders_rowFields');
				assert.strictEqual(rowFields.length, 2);
				assert.strictEqual(rowFields[0].name, 'rowField');
				assert.strictEqual(rowFields[1].name, 'sortOrder');
			});
		});
	});

	describe('Orders', () => {
		it('should get a list of orders', async () => {
			const order1 = await orderLib.createOrder().save();
			const order2 = await orderLib.createOrder().save();

			const { orders, hits } = await orderLib.getOrders();

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(hits, 2);

			for (const uuid in orders) {
				assert.strictEqual(uuidLib.validate(orders[uuid].uuid), true);
				assert.strictEqual([order1.uuid, order2.uuid].includes(uuid), true);
			}
		});

		it('should get orders by uuids', async () => {
			const order1 = await orderLib.createOrder().save();
			await orderLib.createOrder().save();
			const order3 = await orderLib.createOrder().save();

			const { orders } = await orderLib.getOrders({
				uuids: [order1.uuid, order3.uuid],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(Object.keys(orders).includes(order1.uuid), true);
			assert.strictEqual(Object.keys(orders).includes(order3.uuid), true);
		});

		it('should get no orders by non-existing uuids', async () => {
			await orderLib.createOrder().save();

			const { orders, hits } = await orderLib.getOrders({
				uuids: [uuidLib.v1()],
			});

			assert.strictEqual(Object.keys(orders).length, 0);
			assert.strictEqual(hits, 0);
		});

		it('should get no orders by no uuids', async () => {
			await orderLib.createOrder().save();

			const { orders, hits } = await orderLib.getOrders({
				uuids: [],
			});

			assert.strictEqual(Object.keys(orders).length, 0);
			assert.strictEqual(hits, 0);
		});

		it('should get orders with specific returnFields', async () => {
			const order1 = await orderLib.createOrder({ fields: { name: 'Olle', info: 'tolv' } }).save();
			const order2 = await orderLib.createOrder({ fields: { name: 'Conny', info: 'korv' } }).save();

			const { orders } = await orderLib.getOrders({
				returnFields: ['name', 'info'],
			});

			assert.strictEqual(Object.keys(orders[order1.uuid].fields).length, 2);
			assert.strictEqual(orders[order1.uuid].fields?.name[0], 'Olle');
			assert.strictEqual(orders[order1.uuid].fields?.info[0], 'tolv');
			assert.strictEqual(Object.keys(orders[order2.uuid].fields).length, 2);
			assert.strictEqual(orders[order2.uuid].fields?.name[0], 'Conny');
			assert.strictEqual(orders[order2.uuid].fields?.info[0], 'korv');
		});

		it('should get orders with specific row returnFields', async () => {
			const order1 = await orderLib.createOrder({ rows: [{ no: 1, info: 'tolv' }] }).save();
			const order2 = await orderLib.createOrder({ rows: [{ no: 2, info: 'asdf' }, { no: 3, info: 'mhm' }] }).save();

			const { orders } = await orderLib.getOrders({
				returnRowFields: ['no', 'info'],
			});

			assert.strictEqual(orders[order1.uuid].rows.length, 1);
			assert.strictEqual(Object.keys(orders[order1.uuid].rows[0]).length, 3); // uuid always present
			assert.deepStrictEqual(orders[order1.uuid].rows[0].no, [1]);
			assert.deepStrictEqual(orders[order1.uuid].rows[0].info, ['tolv']);
			assert.strictEqual(orders[order2.uuid].rows.length, 2);
			assert.strictEqual(Object.keys(orders[order2.uuid].rows[0]).length, 3); // uuid always present
			assert.deepStrictEqual(orders[order2.uuid].rows[0].no, [2]);
			assert.deepStrictEqual(orders[order2.uuid].rows[0].info, ['asdf']);
			assert.strictEqual(Object.keys(orders[order2.uuid].rows[1]).length, 3); // uuid always present
			assert.deepStrictEqual(orders[order2.uuid].rows[1].no, [3]);
			assert.deepStrictEqual(orders[order2.uuid].rows[1].info, ['mhm']);
		});

		it('should get orders with limit', async () => {
			const order1 = await orderLib.createOrder().save();
			await orderLib.createOrder().save();

			const { orders, hits } = await orderLib.getOrders({
				limit: 1,
			});

			assert.strictEqual(Object.keys(orders).length, 1);
			assert.strictEqual(hits, 2);
			assert.strictEqual(orders[order1.uuid].uuid, order1.uuid);
		});

		it('should get orders with limit and offset', async () => {
			await orderLib.createOrder({ fields: { name: 'Nisse' } }).save();
			const order1 = await orderLib.createOrder({ fields: { name: 'Olle' } }).save();
			const order2 = await orderLib.createOrder({ fields: { name: 'Conny' } }).save();
			await orderLib.createOrder({ fields: { name: 'Benny' } }).save();

			const { orders, hits } = await orderLib.getOrders({
				limit: 2,
				offset: 1,
				returnFields: ['name'],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(hits, 4);
			assert.strictEqual(orders[order1.uuid].fields.name[0], 'Olle');
			assert.strictEqual(orders[order2.uuid].fields.name[0], 'Conny');
		});

		it('should get orders filtered by field content and value', async () => {
			await orderLib.createOrder({ fields: { active: 'false', name: 'Nisse' } }).save();
			const order1 = await orderLib.createOrder({ fields: { active: 'true', name: 'Olle' } }).save();
			await orderLib.createOrder({ fields: { active: 'false', name: 'Conny' } }).save();
			const order2 = await orderLib.createOrder({ fields: { active: 'true', name: 'Benny' } }).save();

			const { orders, hits } = await orderLib.getOrders({
				matchAllFields: { active: 'true' },
				returnFields: ['name', 'active'],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(hits, 2);
			assert.deepStrictEqual(orders[order1.uuid].fields.name, ['Olle']);
			assert.deepStrictEqual(orders[order1.uuid].fields.active, ['true']);
			assert.deepStrictEqual(orders[order2.uuid].fields.name, ['Benny']);
			assert.deepStrictEqual(orders[order2.uuid].fields.active, ['true']);
		});

		it('should get orders filtered by multiple field contents and values', async () => {
			await orderLib.createOrder({ fields: { active: 'false', name: 'Nisse' } }).save();
			await orderLib.createOrder({ fields: { active: 'true', name: 'Olle' } }).save();
			await orderLib.createOrder({ fields: { active: 'false', name: 'Conny' } }).save();
			const order1 = await orderLib.createOrder({ fields: { active: 'true', name: 'Benny' } }).save();

			const { orders, hits } = await orderLib.getOrders({
				matchAllFields: { active: 'true', name: 'Benny' },
				returnFields: ['name', 'active'],
			});

			assert.strictEqual(Object.keys(orders).length, 1);
			assert.strictEqual(hits, 1);
			assert.deepStrictEqual(orders[order1.uuid].fields.name, ['Benny']);
			assert.deepStrictEqual(orders[order1.uuid].fields.active, ['true']);
		});

		it('should get orders filtered by multiple values in one field', async () => {
			const order1 = await orderLib.createOrder({ fields: { name: ['Socker', 'Jonny'] } }).save();
			await orderLib.createOrder({ fields: { name: 'Benny' } }).save();

			const { orders, hits } = await orderLib.getOrders({
				matchAllFields: { name: ['Socker', 'Jonny'] },
				returnFields: ['name'],
			});

			assert.strictEqual(Object.keys(orders).length, 1);
			assert.strictEqual(hits, 1);
			assert.deepStrictEqual(orders[order1.uuid].fields.name, ['Socker', 'Jonny']);
		});

		it('should get orders filtered by row field content', async () => {
			const order1 = await orderLib.createOrder({ rows: [{ price: 50, info: 'tolv' }] }).save();
			const order2 = await orderLib.createOrder({ rows: [{ price: 30, info: 'asdf' }, { price: 50, info: 'tolv' }] }).save();
			await orderLib.createOrder({ rows: [{ price: 20, info: ['katt', 'lödda'] }] }).save();

			const { orders } = await orderLib.getOrders({
				matchAllRowFields: { price: 50, info: 'tolv' },
				returnRowFields: ['price', 'info'],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(orders[order1.uuid].rows.length, 1);
			assert.deepStrictEqual(orders[order1.uuid].rows[0].price, [50]);
			assert.deepStrictEqual(orders[order1.uuid].rows[0].info, ['tolv']);
			assert.strictEqual(orders[order2.uuid].rows.length, 2);
			assert.deepStrictEqual(orders[order2.uuid].rows[0].price, [30]); // Still included in resulting order since another row matches
			assert.deepStrictEqual(orders[order2.uuid].rows[0].info, ['asdf']);
			assert.deepStrictEqual(orders[order2.uuid].rows[1].price, [50]);
			assert.deepStrictEqual(orders[order2.uuid].rows[1].info, ['tolv']);
		});

		it('should get orders by query on fields', async () => {
			const order1 = await orderLib.createOrder({ fields: { name: 'Nisse af Benny Fink' } }).save();
			const order2 = await orderLib.createOrder({ fields: { name: 'Benny' } }).save();
			await orderLib.createOrder({ fields: { name: 'Nisse' } }).save();

			const { orders, hits } = await orderLib.getOrders({
				q: 'benny',
				returnFields: ['name'],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(hits, 2);
			assert.deepStrictEqual(orders[order1.uuid].fields.name, ['Nisse af Benny Fink']);
			assert.deepStrictEqual(orders[order2.uuid].fields.name, ['Benny']);
		});

		it('should get orders by query on row fields', async () => {
			await orderLib.createOrder({ rows: [{ info: 'tolv' }] }).save();
			const order1 = await orderLib.createOrder({ rows: [{ info: 'asdf' }, { info: 'katt-astrof' }] }).save();
			const order2 = await orderLib.createOrder({ rows: [{ info: ['katt@mjau.se', 'lödda'] }] }).save();

			const { orders } = await orderLib.getOrders({
				q: 'katt',
				returnRowFields: ['info'],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(orders[order1.uuid].rows.length, 2);
			assert.deepStrictEqual(orders[order1.uuid].rows[0].info, ['asdf']);
			assert.deepStrictEqual(orders[order1.uuid].rows[1].info, ['katt-astrof']);
			assert.strictEqual(orders[order2.uuid].rows.length, 1);
			assert.deepStrictEqual(orders[order2.uuid].rows[0].info, ['katt@mjau.se', 'lödda']);
		});

		it('should get orders by field not equal to', async () => {
			const order1 = await orderLib.createOrder({ fields: { name: 'Nisse' } }).save();
			await orderLib.createOrder({ fields: { name: 'Benny' } }).save();
			const order2 = await orderLib.createOrder({ fields: { name: 'Olle' } }).save();

			const { orders, hits } = await orderLib.getOrders({
				fieldNotEqualTo: { name: 'Benny' },
				returnFields: ['name'],
			});

			assert.strictEqual(Object.keys(orders).length, 2);
			assert.strictEqual(hits, 2);
			assert.deepStrictEqual(orders[order1.uuid].fields.name, ['Nisse']);
			assert.deepStrictEqual(orders[order2.uuid].fields.name, ['Olle']);
		});

		it('should get orders filtered by fields numerically greather than or equal to', async () => {
			await orderLib.createOrder({ fields: { price: '50' } }).save();
			await orderLib.createOrder({ fields: { price: '9' } }).save();
			await orderLib.createOrder({ fields: { price: '51' } }).save();
			await orderLib.createOrder({ fields: { price: '100' } }).save();

			const { orders } = await orderLib.getOrders({
				fieldGreaterThanOrEqualTo: { price: 50 },
				returnFields: ['price'],
			});

			assert.strictEqual(Object.keys(orders).length, 3);
			const prices = Object.values(orders).map(o => o.fields.price).flat();
			assert.strictEqual(prices.includes('50'), true);
			assert.strictEqual(prices.includes('51'), true);
			assert.strictEqual(prices.includes('100'), true);
		});

		it('should get orders filtered by fields alphanumericly greather than or equal to', async () => {
			await orderLib.createOrder({ fields: { price: '50' } }).save();
			await orderLib.createOrder({ fields: { price: '9' } }).save();
			await orderLib.createOrder({ fields: { price: '51' } }).save();
			await orderLib.createOrder({ fields: { price: '100' } }).save();

			const { orders } = await orderLib.getOrders({
				fieldGreaterThanOrEqualTo: { price: '6' },
				returnFields: ['price'],
			});

			assert.strictEqual(Object.keys(orders).length, 1);
			const prices = Object.values(orders).map(o => o.fields.price).flat();
			assert.strictEqual(prices.includes('9'), true);
		});

		it('should get orders filtered by fields numerically less than or equal to', async () => {
			await orderLib.createOrder({ fields: { price: '50' } }).save();
			await orderLib.createOrder({ fields: { price: '9' } }).save();
			await orderLib.createOrder({ fields: { price: '51' } }).save();
			await orderLib.createOrder({ fields: { price: '100' } }).save();

			const { orders } = await orderLib.getOrders({
				fieldLessThanOrEqualTo: { price: 51 },
				returnFields: ['price'],
			});

			assert.strictEqual(Object.keys(orders).length, 3);
			const prices = Object.values(orders).map(o => o.fields.price).flat();
			assert.strictEqual(prices.includes('50'), true);
			assert.strictEqual(prices.includes('51'), true);
			assert.strictEqual(prices.includes('9'), true);
		});

		it('should get orders filtered by fields alphanumericly less than or equal to', async () => {
			await orderLib.createOrder({ fields: { price: '50' } }).save();
			await orderLib.createOrder({ fields: { price: '9' } }).save();
			await orderLib.createOrder({ fields: { price: '51' } }).save();
			await orderLib.createOrder({ fields: { price: '100' } }).save();

			const { orders } = await orderLib.getOrders({
				fieldLessThanOrEqualTo: { price: '51' },
				returnFields: ['price'],
			});

			assert.strictEqual(Object.keys(orders).length, 3);
			const prices = Object.values(orders).map(o => o.fields.price).flat();
			assert.strictEqual(prices.includes('50'), true);
			assert.strictEqual(prices.includes('51'), true);
			assert.strictEqual(prices.includes('100'), true);
		});

		it('should get order based on created date', async () => {
			await orderLib.createOrder({ created: '2022-12-01T12:37:00.000Z' }).save();
			const order2 = await orderLib.createOrder({ created: '2022-12-01T12:39:00.000Z' }).save();

			const search1 = await orderLib.getOrders({
				createdAfter: '2022-12-01 12:38:00',
			});

			const search2 = await orderLib.getOrders({
				createdAfter: 'hello',
			});

			assert.strictEqual(Object.keys(search1.orders).length, 1);
			assert.strictEqual(search1.hits, 1);
			assert.ok(search1.orders[order2.uuid]);

			assert.strictEqual(search2.hits, 0);
		});

		it('should get order based on updated date', async () => {
			const order1 = await orderLib.createOrder().save();

			// wait 1 second to make sure that the updated date is different
			await new Promise(resolve => setTimeout(resolve, 1000));

			const order2 = await orderLib.createOrder().save();

			const search1 = await orderLib.getOrders({
				updatedAfter: order1.updated,
			});

			const search2 = await orderLib.getOrders({
				updatedAfter: order2.updated,
			});

			const search3 = await orderLib.getOrders({
				updatedAfter: 'hello',
			});

			assert.strictEqual(search1.hits, 2);

			assert.strictEqual(search2.hits, 1);
			assert.strictEqual(search2.orders[order2.uuid].uuid, order2.uuid);

			assert.strictEqual(search3.hits, 0);
		});
	});

});

describe('helpers', () => {
	describe('getFieldValues', () => {
		it('should get available field values from orders', async () => {
			await orderLib.createOrder({ fields: { firstname: 'Nisse' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Olle' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Pelle' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Nisse' } }).save();

			const result = await orderLib.getFieldValues({ fieldName: 'firstname' });
			assert.strictEqual(result.length, 3);
			assert.strictEqual(result[0], 'Nisse');
			assert.strictEqual(result[1], 'Olle');
			assert.strictEqual(result[2], 'Pelle');
		});

		it('should get available field values from orders filtered by single value', async () => {
			await orderLib.createOrder({ fields: { firstname: 'Nisse' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Olle' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Pelle' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Nisse' } }).save();

			const result = await orderLib.getFieldValues({
				fieldName: 'firstname',
				matchAllFields: {
					firstname: 'Olle',
				},
			});
			assert.strictEqual(result.length, 1);
			assert.strictEqual(result[0], 'Olle');
		});

		it('should get available field values from orders filtered by multiple (or) values', async () => {
			await orderLib.createOrder({ fields: { firstname: 'Nisse' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Olle' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Pelle' } }).save();
			await orderLib.createOrder({ fields: { firstname: 'Nisse' } }).save();

			const result = await orderLib.getFieldValues({
				fieldName: 'firstname',
				matchAllFields: {
					firstname: ['Olle', 'Pelle'],
				},
			});
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0], 'Olle');
			assert.strictEqual(result[1], 'Pelle');
		});

		it('should get available field values from orders filtered by another field', async () => {
			await orderLib.createOrder({ fields: { title: 'sir', firstname: 'Nisse' } }).save();
			await orderLib.createOrder({ fields: { title: 'mr', firstname: 'Olle' } }).save();
			await orderLib.createOrder({ fields: { title: 'sir', firstname: 'Pelle' } }).save();
			await orderLib.createOrder({ fields: { title: 'korv', firstname: 'Nisse' } }).save();

			const result = await orderLib.getFieldValues({
				fieldName: 'firstname',
				matchAllFields: {
					title: 'sir',
				},
			});
			assert.strictEqual(result.length, 2);
			assert.strictEqual(result[0], 'Nisse');
			assert.strictEqual(result[1], 'Pelle');
		});
	});
});

after(async () => {
	await db.removeAllTables();
});
