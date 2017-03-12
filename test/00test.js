'use strict';

const	uuidValidate	= require('uuid-validate'),
	Intercom	= require('larvitamintercom'),
	orderLib	= require(__dirname + '/../index.js'),
	uuidLib	= require('uuid'),
	assert	= require('assert'),
	lUtils	= require('larvitutils'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

let	noFieldsOrderUuid;

orderLib.dataWriter.mode = 'master';

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function (done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function (cb) {
		let confFile;

		if (process.env.DBCONFFILE === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.env.DBCONFFILE;
		}

		log.verbose('DB config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('DB config: ' + JSON.stringify(require(confFile)));
					db.setup(require(confFile), cb);
				});

				return;
			}

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));
			db.setup(require(confFile), cb);
		});
	});

	// Check for empty db
	tasks.push(function (cb) {
		db.query('SHOW TABLES', function (err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	// Setup intercom
	tasks.push(function (cb) {
		let confFile;

		if (process.env.INTCONFFILE === undefined) {
			confFile = __dirname + '/../config/amqp_test.json';
		} else {
			confFile = process.env.INTCONFFILE;
		}

		log.verbose('Intercom config file: "' + confFile + '"');

		// First look for absolute path
		fs.stat(confFile, function (err) {
			if (err) {

				// Then look for this string in the config folder
				confFile = __dirname + '/../config/' + confFile;
				fs.stat(confFile, function (err) {
					if (err) throw err;
					log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
					lUtils.instances.intercom = new Intercom(require(confFile).default);
					lUtils.instances.intercom.on('ready', cb);
				});

				return;
			}

			log.verbose('Intercom config: ' + JSON.stringify(require(confFile)));
			lUtils.instances.intercom = new Intercom(require(confFile).default);
			lUtils.instances.intercom.on('ready', cb);
		});
	});

	tasks.push(function (cb) {
		orderLib.dataWriter.ready(cb);
	});

	// Load caches
	tasks.push(function (cb) {
		orderLib.helpers.loadOrderFieldsToCache(cb);
	});
	tasks.push(function (cb) {
		orderLib.helpers.loadRowFieldsToCache(cb);
	});

	async.series(tasks, done);
});

describe('Order', function () {
	let	orderUuid;

	it('should instantiate a new plain order object', function (done) {
		const order = new orderLib.Order();

		assert.deepEqual(toString.call(order),	'[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 1),	true);
		assert.deepEqual(toString.call(order.created),	'[object Date]');
		assert.deepEqual(order.rows instanceof Array,	true);
		assert.deepEqual(order.rows.length,	0);

		done();
	});

	it('should instantiate a new plain order object, with object as option', function (done) {
		const order = new orderLib.Order({});

		assert.deepEqual(toString.call(order),	'[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 1),	true);
		assert.deepEqual(toString.call(order.created),	'[object Date]');
		assert.deepEqual(order.rows instanceof Array,	true);
		assert.deepEqual(order.rows.length,	0);

		done();
	});

	it('should instantiate a new plain order object, with custom uuid', function (done) {
		const order = new orderLib.Order('7ce6ebde-b9a8-11e6-a4a6-cec0c932ce01');

		order.loadFromDb(function (err) {
			if (err) throw err;

			assert.deepEqual(toString.call(order),	'[object Object]');
			assert.deepEqual(uuidValidate(order.uuid, 1),	true);
			assert.deepEqual(order.uuid,	'7ce6ebde-b9a8-11e6-a4a6-cec0c932ce01');
			assert.deepEqual(toString.call(order.created),	'[object Date]');
			assert.deepEqual(order.rows instanceof Array,	true);
			assert.deepEqual(order.rows.length,	0);

			done();
		});
	});

	it('should save an order', function (done) {
		function createOrder(cb) {
			const order = new orderLib.Order();

			orderUuid = order.uuid;

			order.fields	= {'firstname': 'Migal', 'lastname': ['Göransson', 'Kollektiv'], 'active': 'true'};
			order.rows	= [{'price': 399, 'name': 'plutt'}, {'price': 34, 'tags': ['foo', 'bar']}];

			order.save(cb);
		}

		function checkOrder(cb) {
			const tasks = [];

			// Check fields
			tasks.push(function (cb) {
				db.query('SELECT * FROM orders_orderFields', function (err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	3);

					for (let i = 0; rows[i] !== undefined; i ++) {
						assert.notDeepEqual(rows[i].uuid,	undefined);
						assert.notDeepEqual(['active', 'firstname', 'lastname'].indexOf(rows[i].name),	- 1);
					}

					cb(err);
				});
			});

			// Check order fields
			tasks.push(function (cb) {
				db.query('SELECT * FROM orders_orders_fields', function (err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	4);
					assert.deepEqual(lUtils.formatUuid(rows[0].orderUuid),	orderUuid);
					assert.deepEqual(lUtils.formatUuid(rows[1].orderUuid),	orderUuid);
					assert.deepEqual(lUtils.formatUuid(rows[2].orderUuid),	orderUuid);
					assert.deepEqual(lUtils.formatUuid(rows[3].orderUuid),	orderUuid);

					for (let i = 0; rows[i] !== undefined; i ++) {
						assert.notDeepEqual(lUtils.formatUuid(rows[i].fieldUuid),	false);
						assert.notDeepEqual(['Migal', 'Göransson', 'Kollektiv', 'true'].indexOf(rows[i].fieldValue),	- 1);
					}

					cb(err);
				});
			});

			// Check rowfields
			tasks.push(function (cb) {
				db.query('SELECT * FROM orders_rowFields ORDER BY name', function (err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	3);

					for (let i = 0; rows[i] !== undefined; i ++) {
						assert.notDeepEqual(lUtils.formatUuid(rows[i].uuid),	false);
						assert.notDeepEqual(['price', 'name', 'tags'].indexOf(rows[i].name),	- 1);
					}

					cb(err);
				});
			});

			tasks.push(function (cb) {
				db.query('SELECT * FROM orders_rows', function (err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	2);

					cb(err);
				});
			});

			tasks.push(function (cb) {
				db.query('SELECT rowIntValue, rowStrValue FROM orders_rows_fields', function (err, rows) {
					let matchedRows = 0;

					const testRows = [
						{ 'rowIntValue':	399,	'rowStrValue':	null	},
						{ 'rowIntValue':	null,	'rowStrValue':	'plutt'	},
						{ 'rowIntValue':	34,	'rowStrValue':	null	},
						{ 'rowIntValue':	null,	'rowStrValue':	'foo'	},
						{ 'rowIntValue':	null,	'rowStrValue':	'bar'	}
					];

					if (err) throw err;

					assert.deepEqual(rows.length,	5);

					// We do this weirdness because we do not know in what order the rows are saved
					// in the database
					for (let i = 0; rows[i] !== undefined; i ++) {
						for (let i2 = 0; testRows[i2] !== undefined; i2 ++) {
							if (JSON.stringify(rows[i]) === JSON.stringify(testRows[i2])) {
								testRows[i2] = {'fjant': 'nu'};
								matchedRows ++;
							}
						}
					}

					assert.deepEqual(matchedRows,	rows.length);
					assert.deepEqual(rows.length,	testRows.length);

					cb(err);
				});
			});

			async.parallel(tasks, cb);
		}

		async.series([createOrder, checkOrder], function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should save an order without fields', function (done) {
		function createOrder(cb) {
			const order = new orderLib.Order();

			noFieldsOrderUuid	= order.uuid;
			order.rows	= [{'price': 399, 'name': 'plutt'}, {'price': 34, 'tags': ['foo', 'bar']}];

			order.save(cb);
		}

		function checkOrder(cb) {
			const tasks = [];

			// Check order fields
			tasks.push(function (cb) {
				db.query('SELECT * FROM orders_orders_fields WHERE orderUuid = ?', [lUtils.uuidToBuffer(noFieldsOrderUuid)], function (err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	0);

					cb(err);
				});
			});

			tasks.push(function (cb) {
				db.query('SELECT * FROM orders_rows WHERE orderUuid = ?', [lUtils.uuidToBuffer(noFieldsOrderUuid)], function (err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	2);

					cb(err);
				});
			});

			tasks.push(function (cb) {
				const	sql	= 'SELECT rowIntValue, rowStrValue FROM orders_rows_fields WHERE rowUuid IN (SELECT rowUuid FROM orders_rows WHERE orderUuid = ?)';

				db.query(sql, [lUtils.uuidToBuffer(noFieldsOrderUuid)], function (err, rows) {
					let matchedRows = 0;

					const testRows = [
						{ 'rowIntValue':	399,	'rowStrValue':	null	},
						{ 'rowIntValue':	null,	'rowStrValue':	'plutt'	},
						{ 'rowIntValue':	34,	'rowStrValue':	null	},
						{ 'rowIntValue':	null,	'rowStrValue':	'foo'	},
						{ 'rowIntValue':	null,	'rowStrValue':	'bar'	}
					];

					if (err) throw err;

					assert.deepEqual(rows.length,	5);

					// We do this weirdness because we do not know in what order the rows are saved
					// in the database
					for (let i = 0; rows[i] !== undefined; i ++) {
						for (let i2 = 0; testRows[i2] !== undefined; i2 ++) {
							if (JSON.stringify(rows[i]) === JSON.stringify(testRows[i2])) {
								testRows[i2] = {'fjant': 'nu'};
								matchedRows ++;
							}
						}
					}

					assert.deepEqual(matchedRows,	rows.length);
					assert.deepEqual(rows.length,	testRows.length);

					cb(err);
				});
			});

			async.parallel(tasks, cb);
		}

		async.series([createOrder, checkOrder], function (err) {
			if (err) throw err;
			done();
		});
	});

	it('should load saved order from db', function (done) {
		const order = new orderLib.Order(orderUuid);

		order.loadFromDb(function (err) {
			const testRows = [
				{ 'price':	[399],	'name':	['plutt']	},
				{ 'price':	[34],	'tags':	['foo', 'bar']	}
			];

			let matchedRows = 0;

			if (err) throw err;
			assert.deepEqual(order.uuid,	orderUuid);
			assert.deepEqual(order.fields.firstname[0],	'Migal');
			assert.deepEqual(order.fields.lastname[0],	'Göransson');
			assert.deepEqual(order.fields.lastname[1],	'Kollektiv');

			// We do this weirdness because we do not know in what order the rows are saved
			// in the database
			for (let i = 0; order.rows[i] !== undefined; i ++) {
				const row = order.rows[i];
				delete row.uuid;

				for (let i2 = 0; testRows[i2] !== undefined; i2 ++) {
					if (JSON.stringify(row) === JSON.stringify(testRows[i2])) {
						testRows[i2] = {'fjant': 'nu'};
						matchedRows ++;
					}
				}
			}

			assert.deepEqual(matchedRows, order.rows.length);

			done();
		});
	});

	it('should alter an order already saved to db', function (done) {
		const	tasks	= [];

		tasks.push(function (cb) {
			const	order	= new orderLib.Order(orderUuid);

			order.loadFromDb(function (err) {
				if (err) throw err;

				order.fields.boll = ['foo'];

				order.save(function (err) {
					if (err) throw err;

					assert.deepEqual(order.uuid,	orderUuid);
					assert.deepEqual(order.fields.firstname[0],	'Migal');
					assert.deepEqual(order.fields.lastname[0],	'Göransson');
					assert.deepEqual(order.fields.lastname[1],	'Kollektiv');
					assert.deepEqual(order.fields.boll[0],	'foo');

					cb();
				});
			});
		});

		tasks.push(function (cb) {
			const	order	= new orderLib.Order(orderUuid);

			order.loadFromDb(function (err) {
				if (err) throw err;

				assert.deepEqual(order.uuid,	orderUuid);
				assert.deepEqual(order.fields.firstname[0],	'Migal');
				assert.deepEqual(order.fields.firstname.length,	1);
				assert.deepEqual(order.fields.lastname[0],	'Göransson');
				assert.deepEqual(order.fields.lastname[1],	'Kollektiv');
				assert.deepEqual(order.fields.lastname.length,	2);
				assert.deepEqual(order.fields.boll[0],	'foo');

				cb();
			});
		});

		async.series(tasks, done);
	});

	it('should remove an order', function (done) {
		const	tasks	= [];

		let	orders,
			orders_orderFields,
			orders_orders_fields,
			orders_rows,
			orders_rowFields,
			orders_rows_fields;


		function getOrders(cb) {
			db.query('SELECT * FROM orders', cb);
		}

		function getOrderFields(cb) {
			db.query('SELECT * FROM orders_orderFields', cb);
		}

		function getOrderFieldValues(cb) {
			db.query('SELECT * FROM orders_orders_fields', cb);
		}

		function getOrderRows(cb) {
			db.query('SELECT * FROM orders_rows', cb);
		}

		function getOrderRowFields(cb) {
			db.query('SELECT * FROM orders_rowFields', cb);
		}

		function getOrderRowFieldValues(cb) {
			db.query('SELECT * FROM orders_rows_fields', cb);
		}

		// Check order tables before.
		tasks.push(function (cb) {
			const	subtasks	= [];

			// Get orders
			subtasks.push(function (cb) {
				getOrders(function (err, result) {
					orders = result;
					cb(err);
				});
			});

			// Get order fields
			subtasks.push(function (cb) {
				getOrderFields(function (err, result) {
					orders_orderFields	= result;
					cb(err);
				});
			});

			// Get order field values
			subtasks.push(function (cb) {
				getOrderFieldValues(function (err, result) {
					orders_orders_fields	= result;
					cb(err);
				});
			});

			// Get order rows
			subtasks.push(function (cb) {
				getOrderRows(function (err, result) {
					orders_rows	= result;
					cb(err);
				});
			});

			//Get row fields
			subtasks.push(function (cb) {
				getOrderRowFields(function (err, result) {
					orders_rowFields	= result;
					cb(err);
				});
			});

			// Get row field values
			subtasks.push(function (cb) {
				getOrderRowFieldValues(function (err, result) {
					orders_rows_fields	= result;
					cb(err);
				});
			});

			async.parallel(subtasks, cb);
		});

		// Create an order to remove later.
		tasks.push(function (cb) {
			const order = new orderLib.Order();

			orderUuid = order.uuid;

			order.fields	= {'firstname': 'Gaggz0r', 'lastname': ['Difus'], 'active': 'true'};
			order.rows	= [{'price': 99, 'name': 'katt'}, {'price': 34, 'tags': ['hallon', 'korv']}];

			order.save(cb);
		});

		// Remove order
		tasks.push(function (cb) {
			const order = new orderLib.Order(orderUuid);
			order.rm(cb);
		});

		// Check if database is identical after the order removed
		tasks.push(function (cb) {
			const	subtasks	= [];

			// Check orders
			subtasks.push(function (cb) {
				getOrders(function (err, result) {
					assert.deepEqual(orders, result);
					cb(err);
				});
			});

			// Check order fields
			subtasks.push(function (cb) {
				getOrderFields(function (err, result) {
					assert.deepEqual(orders_orderFields, result);
					cb(err);
				});
			});

			// Check order field values
			subtasks.push(function (cb) {
				getOrderFieldValues(function (err, result) {
					assert.deepEqual(orders_orders_fields, result);
					cb(err);
				});
			});

			// Check order rows
			subtasks.push(function (cb) {
				getOrderRows(function (err, result) {
					assert.deepEqual(orders_rows, result);
					cb(err);
				});
			});

			// Check row fields
			subtasks.push(function (cb) {
				getOrderRowFields(function (err, result) {
					assert.deepEqual(orders_rowFields, result);
					cb(err);
				});
			});

			// Check row field values
			subtasks.push(function (cb) {
				getOrderRowFieldValues(function (err, result) {
					assert.deepEqual(orders_rows_fields, result);
					cb(err);
				});
			});

			async.series(subtasks, cb);
		});

		async.series(tasks, function (err) {
			if (err) throw err;
			done();
		});
	});
});

describe('Orders', function () {
	let	dbUuids	= [];

	// Since we've created one order above, it should turn up here
	it('should get a list of orders', function (done) {
		const orders = new orderLib.Orders();

		orders.get(function (err, orderList, orderHits) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	2);
			assert.deepEqual(orderHits,	2);

			for (let uuid in orderList) {
				assert.deepEqual(uuidValidate(orderList[uuid].uuid, 1),	true);
				assert.deepEqual(toString.call(orderList[uuid].created),	'[object Date]');
			}

			done();
		});
	});

	it('should add a few more orders', function (done) {
		const tasks = [];

		tasks.push(function (cb) {
			const order = new orderLib.Order();

			order.fields	= {'firstname': 'Anna', 'lastname': ['Dahl']};
			order.rows	= [{'price': 200, 'name': 'plutt'}, {'price': 50, 'name': 'fjomp'}];

			order.save(cb);
		});

		tasks.push(function (cb) {
			const order = new orderLib.Order();

			order.fields	= {'firstname': 'Anna', 'lastname': 'Dahl', 'active': 'true'};
			order.rows	= [{'price': 150, 'name': 'stenar'}, {'price': 50, 'name': 'svamp'}];

			order.save(cb);
		});

		async.parallel(tasks, done);
	});

	it('should now get 4 orders', function (done) {
		const orders = new orderLib.Orders();

		orders.get(function (err, orderList, orderHits) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	4);
			assert.deepEqual(orderHits,	4);

			for (let uuid in orderList) {
				assert.deepEqual(uuidValidate(orderList[uuid].uuid, 1),	true);
				assert.deepEqual(toString.call(orderList[uuid].created),	'[object Date]');
			}

			done();
		});
	});

	it('should get orders by uuids', function (done) {
		const tasks = [];

		// Get all uuids in db
		tasks.push(function (cb) {
			const orders = new orderLib.Orders();

			orders.get(function (err, orderList) {
				if (err) throw err;

				dbUuids = Object.keys(orderList);

				cb();
			});
		});

		// Get by first uuid
		tasks.push(function (cb) {
			const orders = new orderLib.Orders();

			orders.uuids = dbUuids[0];

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	1);
				assert.deepEqual(orderHits,	1);
				assert.deepEqual(uuidValidate(orderList[dbUuids[0]].uuid, 1),	true);
				assert.deepEqual(orderList[dbUuids[0]].uuid,	dbUuids[0]);
				assert.deepEqual(toString.call(orderList[dbUuids[0]].created),	'[object Date]');

				cb();
			});
		});

		// Get 0 results for wrong uuids
		tasks.push(function (cb) {
			const orders = new orderLib.Orders();

			orders.uuids = uuidLib.v1();

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	0);
				assert.deepEqual(orderHits,	0);

				cb();
			});
		});

		// Get 0 results for no uuids
		tasks.push(function (cb) {
			const orders = new orderLib.Orders();

			orders.uuids = [];

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	0);
				assert.deepEqual(orderHits,	0);

				cb();
			});
		});

		// get 2 results for two uuids
		tasks.push(function (cb) {
			const orders = new orderLib.Orders();

			orders.uuids = [dbUuids[0], dbUuids[2]];

			orders.get(function (err, orderList, orderHits) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	2);
				assert.deepEqual(orderHits,	2);

				assert.deepEqual(uuidValidate(orderList[dbUuids[0]].uuid, 1),	true);
				assert.deepEqual(orderList[dbUuids[0]].uuid,	dbUuids[0]);
				assert.deepEqual(toString.call(orderList[dbUuids[0]].created),	'[object Date]');

				assert.deepEqual(uuidValidate(orderList[dbUuids[2]].uuid, 1),	true);
				assert.deepEqual(orderList[dbUuids[2]].uuid,	dbUuids[2]);
				assert.deepEqual(toString.call(orderList[dbUuids[2]].created),	'[object Date]');

				cb();
			});
		});

		async.series(tasks, done);
	});

	it('should get orders with limits', function (done) {
		const orders = new orderLib.Orders();

		orders.limit = 2;

		orders.get(function (err, orderList, orderHits) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	2);
			assert.deepEqual(orderHits,	4);

			done();
		});
	});

	it('should get orders with limit and offset', function (done) {
		const orders = new orderLib.Orders();

		orders.limit	= 2;
		orders.offset	= 3;

		orders.get(function (err, orderList, orderHits) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');

			// Since there are only 4 rows in the database, a single row should be returned
			assert.deepEqual(Object.keys(orderList).length,	1);
			assert.deepEqual(orderHits,	4);

			done();
		});
	});

	it('should get firstname and lastname from all orders', function (done) {
		const orders = new orderLib.Orders();

		orders.returnFields = ['firstname', 'lastname'];

		orders.get(function (err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	4);

			for (let orderUuid in orderList) {
				let order = orderList[orderUuid];

				if (orderUuid !== noFieldsOrderUuid) {
					assert.deepEqual(order.fields.firstname instanceof Array,	true);
					assert.deepEqual(order.fields.firstname.length,	1);
					assert.deepEqual(order.fields.firstname[0].length > 0,	true);
					assert.deepEqual(order.fields.lastname instanceof Array,	true);
					assert.deepEqual(order.fields.active instanceof Array,	false);
				}

				assert.deepEqual(uuidValidate(order.uuid, 1),	true);
				assert.deepEqual(toString.call(order.created),	'[object Date]');
			}

			done();
		});
	});

	it('should get orders with rows', function (done) {
		const orders = new orderLib.Orders();

		orders.returnRowFields = ['price', 'name'];

		orders.get(function (err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	4);

			for (let orderUuid in orderList) {
				const order = orderList[orderUuid];

				assert.deepEqual(typeof order.rows,	'object');

				for (let rowUuid in order.rows) {
					const row = order.rows[rowUuid];

					assert.deepEqual(typeof row.price[0],	'number');

					if (row.price[0] !== 34) { // This specific row have no name attribute
						assert.deepEqual(typeof row.name[0],	'string');
					}
				}
			}

			done();
		});
	});

	it('should get orders filtered by field content and value', function (done) {
		const orders = new orderLib.Orders();

		orders.matchAllFields = {'active': 'true'};

		orders.get(function (err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList, 'object');

			// Only two orders have the active attribute set to true
			assert.deepEqual(Object.keys(orderList).length,	2);

			done();
		});
	});

	it('should get orders filtered by multiple fields contents and values', function (done) {
		const orders = new orderLib.Orders();

		orders.matchAllFields = {'firstname': 'Anna', 'active': 'true'};

		orders.get(function (err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');

			// Only one order have the active attribute set to true AND the firstname field set to Anna
			assert.deepEqual(Object.keys(orderList).length,	1);

			done();
		});
	});

	it('should get orders filtered by row content', function (done) {
		const orders = new orderLib.Orders();

		orders.matchAllRowFields = {'price': 50};

		orders.get(function (err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');

			// Two orders have rows with a price of 50
			assert.deepEqual(Object.keys(orderList).length,	2);

			done();
		});
	});
});

after(function (done) {
	db.removeAllTables(done);
});
