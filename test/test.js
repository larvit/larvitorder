'use strict';

const larvitorder		= require('../index.js'),
			uuidvalidate	= require('uuid-validate'),
			assert				= require('assert'),
			log     			= require('winston'),
			db      			= require('larvitdb'),
			fs      			= require('fs');

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

	let order;

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

	it('should instantiate a new order object', function(done) {
		let options = {};
		order	= new larvitorder.order(options);
		assert.deepEqual(toString.call(order), '[object Object]');
		done();
	});

	it('should have order object with a valid version4 uuid', function(done) {
		assert.deepEqual(uuidvalidate(order.uuid, 4), true);
		done();
	});

	it('should have order object with created date', function(done) {
		assert.deepEqual(toString.call(order.created), '[object Date]');
		done();
	});

	after(function(done) {
		db.removeAllTables(done);
	});

});
