'use strict';

const	uuidValidate	= require('uuid-validate'),
	uuidLib	= require('node-uuid'),
	assert	= require('assert'),
	async	= require('async'),
	log	= require('winston'),
	db	= require('larvitdb'),
	fs	= require('fs');

// Set up winston
log.remove(log.transports.Console);
/**/log.add(log.transports.Console, {
	'level':	'warn',
	'colorize':	true,
	'timestamp':	true,
	'json':	false
});/**/

before(function(done) {
	this.timeout(10000);
	const	tasks	= [];

	// Run DB Setup
	tasks.push(function(cb) {
		let confFile;

		if (process.argv[3] === undefined) {
			confFile = __dirname + '/../config/db_test.json';
		} else {
			confFile = process.argv[3].split('=')[1];
		}

		log.verbose('DB config file: "' + confFile + '"');

		fs.stat(confFile, function(err) {
			if (err) throw err;

			log.verbose('DB config: ' + JSON.stringify(require(confFile)));

			db.setup(require(confFile), function(err) {
				assert( ! err, 'err should be negative');

				cb();
			});
		});
	});

	// Check for empty db
	tasks.push(function(cb) {
		db.query('SHOW TABLES', function(err, rows) {
			if (err) throw err;

			if (rows.length) {
				throw new Error('Database is not empty. To make a test, you must supply an empty database!');
			}

			cb();
		});
	});

	async.series(tasks, done);
});

describe('Order', function() {
	let	orderUuid,
		orderLib;

	before(function(done) {
		orderLib	= require(__dirname + '/../index.js');
		done();
	});

	it('should instantiate a new plain order object', function(done) {
		const order = new orderLib.Order();

		assert.deepEqual(toString.call(order),	'[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4),	true);
		assert.deepEqual(toString.call(order.created),	'[object Date]');
		assert.deepEqual(order.rows instanceof Array,	true);
		assert.deepEqual(order.rows.length,	0);

		done();
	});

	it('should instantiate a new plain order object, with object as option', function(done) {
		const order = new orderLib.Order({});

		assert.deepEqual(toString.call(order),	'[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4),	true);
		assert.deepEqual(toString.call(order.created),	'[object Date]');
		assert.deepEqual(order.rows instanceof Array,	true);
		assert.deepEqual(order.rows.length,	0);

		done();
	});

	it('should instantiate a new plain order object, with custom uuid', function(done) {
		const order = new orderLib.Order('2d293548-067f-4a88-b23f-cc0e58801512');

		order.loadFromDb(function(err) {
			if (err) throw err;

			assert.deepEqual(toString.call(order),	'[object Object]');
			assert.deepEqual(uuidValidate(order.uuid, 4),	true);
			assert.deepEqual(order.uuid,	'2d293548-067f-4a88-b23f-cc0e58801512');
			assert.deepEqual(toString.call(order.created),	'[object Date]');
			assert.deepEqual(order.rows instanceof Array,	true);
			assert.deepEqual(order.rows.length,	0);

			done();
		});
	});

	it('should save an order', function(done) {
		function createOrder(cb) {
			const order = new orderLib.Order();

			orderUuid = order.uuid;

			order.fields	= {'firstname': 'Migal', 'lastname': ['Göransson', 'Kollektiv'], 'active': 'true'};
			order.rows	= [{'price': 399, 'name': 'plutt'}, {'price': 34, 'tags': ['foo', 'bar']}];

			order.save(cb);
		}

		function checkOrder(cb) {
			const tasks = [];

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_orderFields', function(err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	3);
					assert.deepEqual(rows[0].id,	4);
					assert.deepEqual(rows[1].id,	1);
					assert.deepEqual(rows[2].id,	2);
					assert.deepEqual(rows[0].name,	'active');
					assert.deepEqual(rows[1].name,	'firstname');
					assert.deepEqual(rows[2].name,	'lastname');

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_orders_fields', function(err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	4);
					assert.deepEqual(uuidLib.unparse(rows[0].orderUuid),	orderUuid);
					assert.deepEqual(uuidLib.unparse(rows[1].orderUuid),	orderUuid);
					assert.deepEqual(uuidLib.unparse(rows[2].orderUuid),	orderUuid);
					assert.deepEqual(uuidLib.unparse(rows[3].orderUuid),	orderUuid);
					assert.deepEqual(rows[0].fieldId,	1);
					assert.deepEqual(rows[1].fieldId,	2);
					assert.deepEqual(rows[2].fieldId,	2);
					assert.deepEqual(rows[3].fieldId,	4);
					assert.deepEqual(rows[0].fieldValue,	'Migal');
					assert.deepEqual(rows[1].fieldValue,	'Göransson');
					assert.deepEqual(rows[2].fieldValue,	'Kollektiv');
					assert.deepEqual(rows[3].fieldValue,	'true');

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_rowFields ORDER BY id', function(err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	3);
					assert.deepEqual(rows[0].id,	1);
					assert.deepEqual(rows[1].id,	2);
					assert.deepEqual(rows[2].id,	4); // 4 because the auto_increment increases even when nothing is inserted when INSERT IGNORE INTO. Stupid... but thats life
					assert.deepEqual(rows[0].name,	'price');
					assert.deepEqual(rows[1].name,	'name');
					assert.deepEqual(rows[2].name,	'tags');

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_rows', function(err, rows) {
					if (err) throw err;

					assert.deepEqual(rows.length,	2);

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_rows_fields', function(err, rows) {
					let matchedRows = 0;

					const testRows = [
						{ 'rowFieldId':	1,	'rowIntValue':	399,	'rowStrValue':	null	},
						{ 'rowFieldId':	2,	'rowIntValue':	null,	'rowStrValue':	'plutt'	},
						{ 'rowFieldId':	1,	'rowIntValue':	34,	'rowStrValue':	null	},
						{ 'rowFieldId':	4,	'rowIntValue':	null,	'rowStrValue':	'foo'	},
						{ 'rowFieldId':	4,	'rowIntValue':	null,	'rowStrValue':	'bar'	}
					];

					if (err) throw err;

					assert.deepEqual(rows.length,	5);

					// We do this weirdness because we do not know in what order the rows are saved
					// in the database
					for (let i = 0; rows[i] !== undefined; i ++) {
						delete rows[i].rowUuid;
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

		async.series([createOrder, checkOrder], function(err) {
			if (err) throw err;
			done();
		});
	});

	it('should load saved order from db', function(done) {
		const order = new orderLib.Order(orderUuid);

		order.loadFromDb(function(err) {
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
				delete row.rowUuid;

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
});

describe('Orders', function() {
	let	dbUuids	= [],
		orderLib;

	before(function(done) {
		orderLib	= require(__dirname + '/../index.js');
		done();
	});

	// Since we've created one order above, it should turn up here
	it('should get a list of orders', function(done) {
		const orders = new orderLib.Orders();

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	1);

			for (let uuid in orderList) {
				assert.deepEqual(uuidValidate(orderList[uuid].uuid, 4),	true);
				assert.deepEqual(toString.call(orderList[uuid].created),	'[object Date]');
			}

			done();
		});
	});

	it('should add a few more orders', function(done) {
		const tasks = [];

		tasks.push(function(cb) {
			const order = new orderLib.Order();

			order.fields	= {'firstname': 'Anna', 'lastname': ['Dahl']};
			order.rows	= [{'price': 200, 'name': 'plutt'}, {'price': 50, 'name': 'fjomp'}];

			order.save(cb);
		});

		tasks.push(function(cb) {
			const order = new orderLib.Order();

			order.fields	= {'firstname': 'Anna', 'lastname': 'Dahl', 'active': 'true'};
			order.rows	= [{'price': 150, 'name': 'stenar'}, {'price': 50, 'name': 'svamp'}];

			order.save(cb);
		});

		async.parallel(tasks, done);
	});

	it('should now get 3 orders', function(done) {
		const orders = new orderLib.Orders();

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	3);

			for (let uuid in orderList) {
				assert.deepEqual(uuidValidate(orderList[uuid].uuid, 4),	true);
				assert.deepEqual(toString.call(orderList[uuid].created),	'[object Date]');
			}

			done();
		});
	});

	it('should get orders by uuids', function(done) {
		const tasks = [];

		// Get all uuids in db
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.get(function(err, orderList) {
				if (err) throw err;

				dbUuids = Object.keys(orderList);

				cb();
			});
		});

		// Get by first uuid
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = dbUuids[0];

			orders.get(function(err, orderList) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	1);
				assert.deepEqual(uuidValidate(orderList[dbUuids[0]].uuid, 4),	true);
				assert.deepEqual(orderList[dbUuids[0]].uuid,	dbUuids[0]);
				assert.deepEqual(toString.call(orderList[dbUuids[0]].created),	'[object Date]');

				cb();
			});
		});

		// Get 0 results for wrong uuids
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = uuidLib.v4();

			orders.get(function(err, orderList) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	0);

				cb();
			});
		});

		// Get 0 results for no uuids (empty array)
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = [];

			orders.get(function(err, orderList) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	0);

				cb();
			});
		});

		// get 2 results for two uuids
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = [dbUuids[0], dbUuids[2]];

			orders.get(function(err, orderList) {
				if (err) throw err;
				assert.deepEqual(typeof orderList,	'object');
				assert.deepEqual(Object.keys(orderList).length,	2);

				assert.deepEqual(uuidValidate(orderList[dbUuids[0]].uuid, 4),	true);
				assert.deepEqual(orderList[dbUuids[0]].uuid,	dbUuids[0]);
				assert.deepEqual(toString.call(orderList[dbUuids[0]].created),	'[object Date]');

				assert.deepEqual(uuidValidate(orderList[dbUuids[2]].uuid, 4),	true);
				assert.deepEqual(orderList[dbUuids[2]].uuid,	dbUuids[2]);
				assert.deepEqual(toString.call(orderList[dbUuids[2]].created),	'[object Date]');

				cb();
			});
		});

		async.series(tasks, done);
	});

	it('should get orders with limits', function(done) {
		const orders = new orderLib.Orders();

		orders.limit = 2;

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	2);

			done();
		});
	});

	it('should get orders with limit and offset', function(done) {
		const orders = new orderLib.Orders();

		orders.limit	= 2;
		orders.offset	= 2;

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');

			// Since there are only 3 rows in the database, a single row should be returned
			assert.deepEqual(Object.keys(orderList).length,	1);

			done();
		});
	});

	it('should get firstname and lastname from all orders', function(done) {
		const orders = new orderLib.Orders();

		orders.returnFields = ['firstname', 'lastname'];

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	3);

			for (let orderUuid in orderList) {
				let order = orderList[orderUuid];

				assert.deepEqual(order.fields.firstname instanceof Array,	true);
				assert.deepEqual(order.fields.firstname.length,	1);
				assert.deepEqual(order.fields.firstname[0].length > 0,	true);
				assert.deepEqual(order.fields.lastname instanceof Array,	true);
				assert.deepEqual(order.fields.active instanceof Array,	false);
				assert.deepEqual(uuidValidate(order.uuid, 4),	true);
				assert.deepEqual(toString.call(order.created),	'[object Date]');
			}

			done();
		});
	});

	it('should get orders with rows', function(done) {
		const orders = new orderLib.Orders();

		orders.returnRowFields = ['price', 'name'];

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');
			assert.deepEqual(Object.keys(orderList).length,	3);

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

	it('should get orders filtered by field content and value', function(done) {
		const orders = new orderLib.Orders();

		orders.matchAllFields = {'active': 'true'};

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList, 'object');

			// Only two orders have the active attribute set to true
			assert.deepEqual(Object.keys(orderList).length,	2);

			done();
		});
	});

	it('should get orders filtered by multiple fields contents and values', function(done) {
		const orders = new orderLib.Orders();

		orders.matchAllFields = {'firstname': 'Anna', 'active': 'true'};

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');

			// Only one order have the active attribute set to true AND the firstname field set to Anna
			assert.deepEqual(Object.keys(orderList).length,	1);

			done();
		});
	});

	it('should get orders filtered by row content', function(done) {
		const orders = new orderLib.Orders();

		orders.matchAllRowFields = {'price': 50};

		orders.get(function(err, orderList) {
			if (err) throw err;
			assert.deepEqual(typeof orderList,	'object');

			// Two orders have rows with a price of 50
			assert.deepEqual(Object.keys(orderList).length,	2);

			done();
		});
	});
});

after(function(done) {
	db.removeAllTables(done);
});
