'use strict';

const uuidValidate  = require('uuid-validate'),
      orderLib      = require('../index.js'),
      assert        = require('assert'),
      log           = require('winston'),
      db            = require('larvitdb'),
      fs            = require('fs');

// Set up winston
log.remove(log.transports.Console);

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
		// Check for empty db
		db.query('SHOW TABLES', function(err, rows) {
			if (err) {
				assert( ! err, 'err should be negative');
				log.error(err);
				process.exit(1);
			}

			if (rows.length) {
				assert.deepEqual(rows.length, 0);
				log.error('Database is not empty. To make a test, you must supply an empty database!');
				process.exit(1);
			}

			done();
		});
	});

	it('should instantiate a new plain order object', function(done) {
		const order = new orderLib.order();

		assert.deepEqual(toString.call(order), '[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4), true);
		assert.deepEqual(toString.call(order.created), '[object Date]');
		assert.deepEqual(order.rows instanceof Array, true);
		assert.deepEqual(order.rows.length, 0);

		done();
	});

	it('should instantiate a new plain order object, with object as option', function(done) {
		const order = new orderLib.order({});

		assert.deepEqual(toString.call(order), '[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4), true);
		assert.deepEqual(toString.call(order.created), '[object Date]');
		assert.deepEqual(order.rows instanceof Array, true);
		assert.deepEqual(order.rows.length, 0);

		done();
	});

	it('should instantiate a new plain order object, with custom uuid', function(done) {
		const order = new orderLib.order('2d293548-067f-4a88-b23f-cc0e58801512');

		assert.deepEqual(toString.call(order), '[object Object]');
		assert.deepEqual(uuidValidate(order.uuid, 4), true);
		assert.deepEqual(order.uuid, '2d293548-067f-4a88-b23f-cc0e58801512');
		assert.deepEqual(toString.call(order.created), '[object Date]');
		assert.deepEqual(order.rows instanceof Array, true);
		assert.deepEqual(order.rows.length, 0);

		done();
	});

	after(function(done) {
		db.removeAllTables(done);
	});
});
