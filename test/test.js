'use strict';

const uuidValidate  = require('uuid-validate'),
      dbMigration   = require('larvitdbmigration')({'migrationScriptsPath': __dirname + '/../dbmigration'}),
      orderLib      = require('../index.js'),
      assert        = require('assert'),
      async         = require('async'),
      log           = require('winston'),
      db            = require('larvitdb'),
      fs            = require('fs');

/**
 * To implement

const order = new orderLib.Order();

// All values can be arrays of values
order.get(function(err, orderData));
order.getRows(function(err, orderRows));
order.getFields(function(err, orderFields));

order.set(orderData {'uuid': 'sdfa', 'fields': {key:value}, 'rows': [{key:value},{key:value}...]}, function(err));
order.setRows([{key:value},{key:value}...]);
order.setRow('uuid', {key:value});
order.setFields({key:value});
order.setField(key, value, replace (boolean));

order.setField('firstname', ['Kollektiv', 'Migal']);

order.save(function(err))
*/

// Set up winston
log.remove(log.transports.Console);
/** /log.add(log.transports.Console, {
	'level': 'silly',
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

	it('should save an order and check result', function(done) {
		let orderUuid;

		function createOrder(cb) {
			const order = new orderLib.Order();

			orderUuid = order.uuid;

			order.fields = {'firstname': 'Migal', 'lastname': ['Göransson', 'Kollektiv']};
			order.rows   = [{'price': 399, 'name': 'plutt'}, {'price': 34, 'tags': ['foo', 'bar']}];

			order.save(cb);
		}

		function checkOrder(cb) {
			const order = new orderLib.Order(orderUuid);

			order.loadFromDb(function(err) {
				assert( ! err, 'err should be negative');
				assert.deepEqual(order.uuid, orderUuid);
				assert.deepEqual(order.fields.firstname[0], 'Migal');
				assert.deepEqual(order.rows[0].price[0], 399);
				assert.deepEqual(order.fields.lastname[0], 'Göransson');
				assert.deepEqual(order.fields.lastname[1], 'Kollektiv');

				cb();
			});
		}

		async.series([createOrder, checkOrder], function(err) {
			assert( ! err, 'err should be negative');
			done();
		});
	});
});

/*describe('Orders', function() {

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
});*/

after(function(done) {
	db.removeAllTables(done);
});
