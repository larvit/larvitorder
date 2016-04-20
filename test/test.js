'use strict';

const uuidValidate  = require('uuid-validate'),
      dbMigration   = require('larvitdbmigration')({'migrationScriptsPath': __dirname + '/../dbmigration'}),
      orderLib      = require(__dirname + '/../index.js'),
      uuidLib       = require('node-uuid'),
      assert        = require('assert'),
      async         = require('async'),
      log           = require('winston'),
      db            = require('larvitdb'),
      fs            = require('fs');

// Set up winston
log.remove(log.transports.Console);
/** /log.add(log.transports.Console, {
	'level': 'verbose',
	'colorize': true,
	'timestamp': true,
	'json': false
});/**/

before(function(done) {
	let confFile;

	function runDbSetup(confFile) {
		log.verbose('DB config: ' + JSON.stringify(require(confFile)));

		db.setup(require(confFile), function(err) {
			assert( ! err, 'err should be negative');

			done();
		});
	}

	if (process.argv[3] === undefined)
		confFile = __dirname + '/../config/db_test.json';
	else
		confFile = process.argv[3].split('=')[1];

	log.verbose('DB config file: "' + confFile + '"');

	fs.stat(confFile, function(err) {
		const altConfFile = __dirname + '/../config/' + confFile;

		if (err) {
			log.info('Failed to find config file "' + confFile + '", retrying with "' + altConfFile + '"');

			fs.stat(altConfFile, function(err) {
				if (err)
					assert( ! err, 'fs.stat failed: ' + err.message);

				if ( ! err)
					runDbSetup(altConfFile);
			});
		} else {
			runDbSetup(confFile);
		}
	});
});

describe('Order', function() {
	let orderUuid;

	before(function(done) {
		this.timeout(10000);

		// Check for empty db
		db.query('SHOW TABLES', function(err, rows) {
			if (err) {
				assert( ! err, 'err should be negative');
				log.error(err);
				process.exit(1);
			}

			if (rows.length) {
				log.error('Database is not empty. To make a test, you must supply an empty database!');
				process.exit(1);
			}

			dbMigration(function(err) {
				assert( ! err, 'err should be negative');
				done();
			});
		});
	});

	it('should instantiate a new plain order object', function(done) {
		const order = new orderLib.Order();

		assert.deepEqual(toString.call(order), '[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4), true);
		assert.deepEqual(toString.call(order.created), '[object Date]');
		assert.deepEqual(order.rows instanceof Array, true);
		assert.deepEqual(order.rows.length, 0);

		done();
	});

	it('should instantiate a new plain order object, with object as option', function(done) {
		const order = new orderLib.Order({});

		assert.deepEqual(toString.call(order), '[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4), true);
		assert.deepEqual(toString.call(order.created), '[object Date]');
		assert.deepEqual(order.rows instanceof Array, true);
		assert.deepEqual(order.rows.length, 0);

		done();
	});

	it('should instantiate a new plain order object, with custom uuid', function(done) {
		const order = new orderLib.Order('2d293548-067f-4a88-b23f-cc0e58801512');

		order.loadFromDb(function(err) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(toString.call(order), '[object Object]');
			assert.deepEqual(uuidValidate(order.uuid, 4), true);
			assert.deepEqual(order.uuid, '2d293548-067f-4a88-b23f-cc0e58801512');
			assert.deepEqual(toString.call(order.created), '[object Date]');
			assert.deepEqual(order.rows instanceof Array, true);
			assert.deepEqual(order.rows.length, 0);

			done();
		});
	});

	it('should save an order', function(done) {
		function createOrder(cb) {
			const order = new orderLib.Order();

			orderUuid = order.uuid;

			order.fields = {'firstname': 'Migal', 'lastname': ['Göransson', 'Kollektiv']};
			order.rows   = [{'price': 399, 'name': 'plutt'}, {'price': 34, 'tags': ['foo', 'bar']}];

			order.save(cb);
		}

		function checkOrder(cb) {
			const tasks = [];

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_orderFields', function(err, rows) {
					assert( ! err, 'err should be negative');

					assert.deepEqual(rows.length, 2);
					assert.deepEqual(rows[0].id, 1);
					assert.deepEqual(rows[1].id, 2);
					assert.deepEqual(rows[0].name, 'firstname');
					assert.deepEqual(rows[1].name, 'lastname');

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_orders_fields', function(err, rows) {
					assert( ! err, 'err should be negative');

					assert.deepEqual(rows.length, 3);
					assert.deepEqual(uuidLib.unparse(rows[0].orderUuid), orderUuid);
					assert.deepEqual(uuidLib.unparse(rows[1].orderUuid), orderUuid);
					assert.deepEqual(uuidLib.unparse(rows[2].orderUuid), orderUuid);
					assert.deepEqual(rows[0].fieldId, 1);
					assert.deepEqual(rows[1].fieldId, 2);
					assert.deepEqual(rows[2].fieldId, 2);
					assert.deepEqual(rows[0].fieldValue, 'Migal');
					assert.deepEqual(rows[1].fieldValue, 'Göransson');
					assert.deepEqual(rows[2].fieldValue, 'Kollektiv');

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_rowFields ORDER BY id', function(err, rows) {
					assert( ! err, 'err should be negative');

					assert.deepEqual(rows.length, 3);
					assert.deepEqual(rows[0].id, 1);
					assert.deepEqual(rows[1].id, 2);
					assert.deepEqual(rows[2].id, 4); // 4 because the auto_increment increases even when nothing is inserted when INSERT IGNORE INTO. Stupid... but thats life
					assert.deepEqual(rows[0].name, 'price');
					assert.deepEqual(rows[1].name, 'name');
					assert.deepEqual(rows[2].name, 'tags');

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_rows', function(err, rows) {
					assert( ! err, 'err should be negative');

					assert.deepEqual(rows.length, 2);

					cb(err);
				});
			});

			tasks.push(function(cb) {
				db.query('SELECT * FROM orders_rows_fields', function(err, rows) {
					assert( ! err, 'err should be negative');

					assert.deepEqual(rows.length, 5);
					assert.deepEqual(rows[0].rowFieldId, 1);
					assert.deepEqual(rows[1].rowFieldId, 2);
					assert.deepEqual(rows[2].rowFieldId, 1);
					assert.deepEqual(rows[3].rowFieldId, 4);
					assert.deepEqual(rows[4].rowFieldId, 4);
					assert.deepEqual(rows[0].rowIntValue, 399);
					assert.deepEqual(rows[1].rowIntValue, null);
					assert.deepEqual(rows[2].rowIntValue, 34);
					assert.deepEqual(rows[3].rowIntValue, null);
					assert.deepEqual(rows[4].rowIntValue, null);
					assert.deepEqual(rows[0].rowStrValue, null);
					assert.deepEqual(rows[1].rowStrValue, 'plutt');
					assert.deepEqual(rows[2].rowStrValue, null);
					assert.deepEqual(rows[3].rowStrValue, 'foo');
					assert.deepEqual(rows[4].rowStrValue, 'bar');

					cb(err);
				});
			});

			async.parallel(tasks, cb);
		}

		async.series([createOrder, checkOrder], function(err) {
			assert( ! err, 'err should be negative');
			done();
		});
	});

	it('should load saved order from db', function(done) {
		const order = new orderLib.Order(orderUuid);

		order.loadFromDb(function(err) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(order.uuid, orderUuid);
			assert.deepEqual(order.fields.firstname[0], 'Migal');
			assert.deepEqual(order.rows[0].price[0], 399);
			assert.deepEqual(order.fields.lastname[0], 'Göransson');
			assert.deepEqual(order.fields.lastname[1], 'Kollektiv');

			done();
		});
	});
});

describe('Orders', function() {
	const dbUuids = [];

	// Since we've created one order above, it should turn up here
	it('should get a list of orders', function(done) {
		const orders = new orderLib.Orders();

		orders.get(function(err, orderList) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(orderList instanceof Array, true);
			assert.deepEqual(orderList.length, 1);

			for (let i = 0; orderList[i] !== undefined; i ++) {
				assert.deepEqual(uuidValidate(orderList[i].uuid, 4), true);
				assert.deepEqual(toString.call(orderList[i].created), '[object Date]');
			}

			done();
		});
	});

	it('should add a few more orders', function(done) {
		const tasks = [];

		tasks.push(function(cb) {
			const order = new orderLib.Order();

			order.fields = {'firstname': 'Anna', 'lastname': ['Dahl']};
			order.rows   = [{'price': 200, 'name': 'plutt'}, {'price': 50, 'name': 'fjomp'}];

			order.save(cb);
		});

		tasks.push(function(cb) {
			const order = new orderLib.Order();

			order.fields = {'firstname': 'Anna', 'lastname': 'Dahl', 'active': 'true'};
			order.rows   = [{'price': 150, 'name': 'stenar'}, {'price': 50, 'name': 'svamp'}];

			order.save(cb);
		});

		async.parallel(tasks, done);
	});

	it('should now get 3 orders', function(done) {
		const orders = new orderLib.Orders();

		orders.get(function(err, orderList) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(orderList instanceof Array, true);
			assert.deepEqual(orderList.length, 3);

			for (let i = 0; orderList[i] !== undefined; i ++) {
				assert.deepEqual(uuidValidate(orderList[i].uuid, 4), true);
				assert.deepEqual(toString.call(orderList[i].created), '[object Date]');
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
				assert( ! err, 'err should be negative');

				for (let i = 0; orderList[i] !== undefined; i ++) {
					dbUuids.push(orderList[i].uuid);
				}

				cb();
			});
		});

		// Get by first uuid
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = dbUuids[0];

			orders.get(function(err, orderList) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(orderList instanceof Array, true);
				assert.deepEqual(orderList.length, 1);
				assert.deepEqual(uuidValidate(orderList[0].uuid, 4), true);
				assert.deepEqual(orderList[0].uuid, dbUuids[0]);
				assert.deepEqual(toString.call(orderList[0].created), '[object Date]');

				cb();
			});
		});

		// Get 0 results for wrong uuids
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = uuidLib.v4();

			orders.get(function(err, orderList) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(orderList instanceof Array, true);
				assert.deepEqual(orderList.length, 0);

				cb();
			});
		});

		// Get 0 results for no uuids (empty array)
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = [];

			orders.get(function(err, orderList) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(orderList instanceof Array, true);
				assert.deepEqual(orderList.length, 0);

				cb();
			});
		});

		// get 2 results for two uuids
		tasks.push(function(cb) {
			const orders = new orderLib.Orders();

			orders.uuids = [dbUuids[0], dbUuids[2]];

			orders.get(function(err, orderList) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(orderList instanceof Array, true);
				assert.deepEqual(orderList.length, 2);

				assert.deepEqual(uuidValidate(orderList[0].uuid, 4), true);
				assert.deepEqual(orderList[0].uuid, dbUuids[0]);
				assert.deepEqual(toString.call(orderList[0].created), '[object Date]');

				assert.deepEqual(uuidValidate(orderList[1].uuid, 4), true);
				assert.deepEqual(orderList[1].uuid, dbUuids[2]);
				assert.deepEqual(toString.call(orderList[1].created), '[object Date]');

				cb();
			});
		});

		async.series(tasks, done);
	});

	it('should get orders with limits', function(done) {
		const orders = new orderLib.Orders();

		orders.limit = 2;

		orders.get(function(err, orderList) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(orderList instanceof Array, true);
			assert.deepEqual(orderList.length, 2);

			done();
		});
	});

	it('should get orders with limit and offset', function(done) {
		const orders = new orderLib.Orders();

		orders.limit  = 2;
		orders.offset = 2;

		orders.get(function(err, orderList) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(orderList instanceof Array, true);

			// Since there are only 3 rows in the database, a single row should be returned
			assert.deepEqual(orderList.length, 1);

			done();
		});
	});

	it('should get firstname and lastname from all orders', function(done) {
		const orders = new orderLib.Orders();

		orders.returnFields = ['firstname', 'lastname'];

		orders.get(function(err, orderList) {
			assert( ! err, 'err should be negative');
			assert.deepEqual(orderList instanceof Array, true);
			assert.deepEqual(orderList.length, 3);

			for (let i = 0; orderList[i] !== undefined; i ++) {
				let order = orderList[i];

				assert.deepEqual(typeof order.fields.firstname, 'string');
				assert.deepEqual(uuidValidate(order.uuid, 4), true);
				assert.deepEqual(toString.call(order.created), '[object Date]');
			}

			done();
		});
	});
});

after(function(done) {
	db.removeAllTables(done);
});
